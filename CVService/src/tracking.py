from math import hypot, isfinite, sqrt
from time import monotonic_ns

import mediapipe as mp
import numpy as np
from PIL import Image

from .gestures import MAX_SAMPLE_GAP_MS, GestureMachine, classify_hand
from .model import read_model


# Observe up to two people, then send only the foreground operator's hands.
MAX_CANDIDATES = 4
SEARCH_EVERY_FRAMES = 3
MIN_RELATIVE_SCALE = 0.80
# Pixels per estimated palm meter, divided by the shorter image edge.
MIN_IMAGE_SCALE = 1.2
PALM_BONES = ((0, 5), (0, 9), (0, 13), (0, 17), (5, 17))


def projected_scale(points, world, width, height):
    if len(world) != 21:
        return 0.0

    # Fit image pixels per model meter using the same XY projections. A palm
    # tilted away from the lens foreshortens in both sets of landmarks.
    image_sq = world_sq = 0.0
    for a, b in PALM_BONES:
        dx = (points[a][0] - points[b][0]) * width
        dy = (points[a][1] - points[b][1]) * height
        image_sq += dx * dx + dy * dy
        world_sq += (world[a].x - world[b].x) ** 2 + (world[a].y - world[b].y) ** 2

    if not isfinite(world_sq) or world_sq < 1e-6:
        return 0.0

    return sqrt(image_sq / world_sq) / min(width, height)


def create_landmarker(max_hands):
    options = mp.tasks.vision.HandLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_buffer=read_model()),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_hands=max_hands,
    )
    return mp.tasks.vision.HandLandmarker.create_from_options(options)


class HandTracker:
    def __init__(self):
        self.landmarker = create_landmarker(2)
        self.search_landmarker = None
        self.saturated_frames = 0
        self.fast_wrists = []
        self.crowded = False
        self.last_timestamp_ms = -1
        self.foreground_scale = 0.0

    def _infer(self, image: Image.Image):
        timestamp_ms = max(self.last_timestamp_ms + 1, monotonic_ns() // 1_000_000)
        if timestamp_ms - self.last_timestamp_ms >= MAX_SAMPLE_GAP_MS:
            self.foreground_scale = 0.0
        self.last_timestamp_ms = timestamp_ms
        rgb = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(image))
        # A two-slot VIDEO tracker stops looking for new palms once both slots
        # are filled. Periodically substitute a wider search at saturation.
        searching = self.crowded or self.saturated_frames >= SEARCH_EVERY_FRAMES - 1
        tracker = self.landmarker
        if searching:
            if self.search_landmarker is None:
                self.search_landmarker = create_landmarker(MAX_CANDIDATES)
            tracker = self.search_landmarker

        result = tracker.detect_for_video(rgb, timestamp_ms)
        wrists = [(hand[0].x, hand[0].y) for hand in result.hand_landmarks if hand]
        if searching:
            # Keep the wider tracker if it found a hand missing from the fast
            # tracker. Switching back could immediately reclaim a stale pair.
            new_hand = any(all(hypot(x - u, y - v) > 0.10 for u, v in self.fast_wrists) for x, y in wrists)
            self.crowded = bool(wrists) and (self.crowded or len(wrists) > 2 or new_hand)
            self.saturated_frames = 0
        else:
            self.fast_wrists = wrists
            self.saturated_frames = self.saturated_frames + 1 if len(wrists) == 2 else 0

        return result

    @staticmethod
    def _normalized_hands(result) -> list[dict]:
        hands = []
        if len(result.hand_landmarks) > MAX_CANDIDATES:
            raise ValueError("Unexpected hand count.")

        for landmarks in result.hand_landmarks:
            if len(landmarks) != 21:
                raise ValueError("Incomplete hand landmarks.")

            points = []
            for landmark in landmarks:
                point = (landmark.x, landmark.y, landmark.z)
                if not all(isfinite(value) and abs(value) <= 8 for value in point):
                    raise ValueError("Invalid landmark coordinate.")
                points.append([round(value, 5) for value in point])

            hands.append({"landmarks": points})

        return hands

    def _foreground(self, image):
        result = self._infer(image)
        candidates = self._normalized_hands(result)
        scales = [projected_scale(hand["landmarks"], world, *image.size)
                  for hand, world in zip(candidates, result.hand_world_landmarks)]
        nearest = max(scales, default=0.0)
        cutoff = max(MIN_IMAGE_SCALE, MIN_RELATIVE_SCALE * max(nearest, self.foreground_scale))
        ranked = sorted(range(len(scales)), key=scales.__getitem__, reverse=True)
        eligible = [index for index in ranked if scales[index] >= cutoff]
        indices = []
        used_sides = set()
        for index in eligible:
            labels = result.handedness[index] if index < len(result.handedness) else []
            side = labels[0].category_name if labels and labels[0].score >= 0.9 else None
            if side in used_sides:
                continue
            indices.append(index)
            if side:
                used_sides.add(side)
            if len(indices) == 2:
                break
        indices.sort()

        # Once a farther hand is rejected, it must not take control just
        # because the foreground hands disappear while it remains in view.
        if not candidates:
            self.foreground_scale = 0.0
        elif indices and (self.foreground_scale or any(scale < cutoff for scale in scales)):
            self.foreground_scale = nearest

        return result, [candidates[index] for index in indices], indices

    def detect(self, image: Image.Image) -> list[dict]:
        _, hands, _ = self._foreground(image)
        return hands

    def detect_gestures(self, image: Image.Image, gestures: GestureMachine, captured_at_ms: float):
        result, hands, indices = self._foreground(image)
        poses = []
        for index, hand in zip(indices, hands):
            side = result.handedness[index] if index < len(result.handedness) else []
            world = result.hand_world_landmarks[index] if index < len(result.hand_world_landmarks) else []
            poses.append(classify_hand(
                [(p.x, p.y, p.z) for p in world], hand["landmarks"],
                side[0].category_name if side else "", image.height / image.width,
            ))

        gesture = gestures.update(poses, captured_at_ms)
        if gestures.active_index == 1:
            hands.reverse()
        return hands, gesture

    def close(self):
        try:
            self.landmarker.close()
        finally:
            if self.search_landmarker is not None:
                self.search_landmarker.close()
