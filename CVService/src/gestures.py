"""Per-stream gesture recognition from MediaPipe hand observations."""
from dataclasses import dataclass
from math import dist, hypot, isfinite


MAX_SAMPLE_GAP_MS = 200
BEND_WINDOW_MS = 160
MOTION_HOLD_MS = 100
MOTION_PALM_FRACTION = 0.08


@dataclass(frozen=True)
class HandPose:
    side: str
    center: tuple[float, float]
    width: float
    fingers: tuple[bool, ...]
    index_straight: bool
    index_bent: bool
    facing_camera: bool


def classify_hand(world, image_points, side, aspect_y):
    """Use metric joints for pose and image-width units for on-screen movement."""
    if len(world) != 21 or not all(isfinite(v) for point in world for v in point):
        return None

    palm_width = dist(world[5], world[17])
    if palm_width < 0.001:
        return None

    fingers = []
    ratios = []
    for base in (1, 5, 9, 13, 17):
        tip = world[base + 3]
        length = sum(dist(world[i], world[i + 1]) for i in range(base, base + 3))
        if length < 0.001:
            return None

        ratio = dist(world[base], tip) / length
        ratios.append(ratio)
        if base == 1:
            # An adducted thumb can be straight while resting across the palm.
            extended = (dist(tip, world[5]) > 0.55 * palm_width
                        and dist(tip, world[17]) > dist(world[3], world[17]) + 0.08 * palm_width)
        else:
            extended = dist(tip, world[0]) > dist(world[base], world[0]) + 0.25 * palm_width
        fingers.append(ratio >= 0.88 and extended)

    index = [a - b for a, b in zip(world[5], world[0])]
    pinky = [a - b for a, b in zip(world[17], world[0])]
    normal_x = index[1] * pinky[2] - index[2] * pinky[1]
    normal_y = index[2] * pinky[0] - index[0] * pinky[2]
    normal_z = index[0] * pinky[1] - index[1] * pinky[0]
    # Wrist/index/pinky winding in image axes, using the model's own side label.
    toward_camera = {"Right": -1, "Left": 1}.get(side, 0) * normal_z
    facing = toward_camera > 0.45 * hypot(normal_x, normal_y, normal_z)

    palm = [image_points[i] for i in (0, 5, 9, 13, 17)]
    center = (sum(p[0] for p in palm) / 5, aspect_y * sum(p[1] for p in palm) / 5)
    width = hypot(image_points[5][0] - image_points[17][0],
                  aspect_y * (image_points[5][1] - image_points[17][1]))
    index_bent = ratios[1] <= 0.72 or dist(world[8], world[0]) <= dist(world[5], world[0]) + 0.05 * palm_width
    return HandPose(side, center, width, tuple(fingers), ratios[1] >= 0.93, index_bent, facing)


class GestureMachine:
    def __init__(self):
        self.reset()

    def reset(self):
        self.last_sample_ms = None
        self.last_hand = None
        self.extended_at = None
        self.control = "idle"
        self.anchor = None
        self.direction = "ready"
        self.moved_at = 0.0

    def update(self, hands, captured_at_ms):
        if self.last_sample_ms is not None and not 0 < captured_at_ms - self.last_sample_ms < MAX_SAMPLE_GAP_MS:
            self.reset()

        if not hands or any(hand is None for hand in hands):
            self.reset()
            return "idle"

        hand = hands[0]
        if len(hands) == 1 and self.last_hand is not None:
            if (hand.side != self.last_hand.side
                    or dist(hand.center, self.last_hand.center) > 1.5 * max(hand.width, self.last_hand.width)):
                self.reset()
        self.last_sample_ms = captured_at_ms
        self.last_hand = hand if len(hands) == 1 else None

        if len(hands) == 2 and all(all(h.fingers) for h in hands):
            separation = dist(hand.center, hands[1].center)
            return self._motion("zoom", (separation, 0), (hand.width + hands[1].width) / 2, captured_at_ms)

        if len(hands) == 1:
            if all(hand.fingers) and hand.facing_camera:
                return self._motion("pan", hand.center, hand.width, captured_at_ms)
            if sum(hand.fingers) == 2:
                return self._motion("rotate", hand.center, hand.width, captured_at_ms)

            self.control = "idle"
            if hand.fingers == (False, True, False, False, False):
                if hand.index_straight:
                    self.extended_at = captured_at_ms
                return "cursor"

            if not any(hand.fingers) and self.extended_at is not None:
                if captured_at_ms - self.extended_at <= BEND_WINDOW_MS:
                    if not hand.index_bent:
                        return "idle"
                    self.extended_at = None
                    return "select"

        self.reset()
        return "idle"

    def _motion(self, control, position, width, now):
        self.extended_at = None
        if self.control != control:
            self.control = control
            self.anchor = position
            self.direction = "ready"
            return control + "_ready"

        dx = position[0] - self.anchor[0]
        dy = position[1] - self.anchor[1] if control == "pan" else 0.0
        if max(abs(dx), abs(dy)) >= max(0.005, width * MOTION_PALM_FRACTION):
            if control == "zoom":
                self.direction = "in" if dx > 0 else "out"
            elif abs(dy) > abs(dx):
                self.direction = "down" if dy > 0 else "up"
            else:
                self.direction = "left" if dx > 0 else "right"
            self.anchor = position
            self.moved_at = now
        elif now - self.moved_at >= MOTION_HOLD_MS:
            self.direction = "ready"

        return control + "_" + self.direction
