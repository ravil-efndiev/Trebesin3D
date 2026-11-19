from math import isfinite
from time import monotonic_ns

import mediapipe as mp
import numpy as np
from PIL import Image

from .gestures import GestureMachine, classify_hand
from .model import read_model


class HandTracker:
    def __init__(self):
        options = mp.tasks.vision.HandLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_buffer=read_model()),
            running_mode=mp.tasks.vision.RunningMode.VIDEO,
            num_hands=2,
        )
        self.landmarker = mp.tasks.vision.HandLandmarker.create_from_options(options)
        self.last_timestamp_ms = -1

    def _infer(self, image: Image.Image):
        timestamp_ms = max(self.last_timestamp_ms + 1, monotonic_ns() // 1_000_000)
        self.last_timestamp_ms = timestamp_ms
        rgb = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(image))
        return self.landmarker.detect_for_video(rgb, timestamp_ms)

    @staticmethod
    def _normalized_hands(result) -> list[dict]:
        hands = []
        if len(result.hand_landmarks) > 2:
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

    def detect(self, image: Image.Image) -> list[dict]:
        return self._normalized_hands(self._infer(image))

    def detect_gestures(self, image: Image.Image, gestures: GestureMachine, captured_at_ms: float):
        result = self._infer(image)
        hands = self._normalized_hands(result)
        poses = []
        for index, hand in enumerate(hands):
            side = result.handedness[index] if index < len(result.handedness) else []
            world = result.hand_world_landmarks[index] if index < len(result.hand_world_landmarks) else []
            poses.append(classify_hand(
                [(p.x, p.y, p.z) for p in world], hand["landmarks"],
                side[0].category_name if side else "", image.height / image.width,
            ))

        return hands, gestures.update(poses, captured_at_ms)

    def close(self):
        self.landmarker.close()
