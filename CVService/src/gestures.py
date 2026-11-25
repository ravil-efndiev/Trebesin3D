"""Per-stream gesture recognition from MediaPipe hand observations."""
from dataclasses import dataclass
from math import acos, degrees, dist, hypot, isfinite


MAX_SAMPLE_GAP_MS = 200
BEND_WINDOW_MS = 280
BEND_START_DEGREES = 12
BEND_TRIGGER_DEGREES = 25
INDEX_ONLY = (False, True, False, False, False)
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
    index_angles: tuple[float, float]
    facing_camera: bool


def joint_bend(before, joint, after):
    incoming = [b - a for a, b in zip(before, joint)]
    outgoing = [b - a for a, b in zip(joint, after)]
    lengths = hypot(*incoming) * hypot(*outgoing)
    if lengths < 1e-8:
        return 0.0
    cosine = sum(a * b for a, b in zip(incoming, outgoing)) / lengths
    return degrees(acos(max(-1.0, min(1.0, cosine))))


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
    # Leave a gap between arming and firing so jitter around extension cannot click.
    index_bent = ratios[1] <= 0.84 or dist(world[8], world[0]) <= dist(world[5], world[0]) + 0.05 * palm_width
    index_angles = (joint_bend(*world[5:8]), joint_bend(*world[6:9]))
    return HandPose(side, center, width, tuple(fingers), ratios[1] >= 0.90, index_bent, index_angles, facing)


class GestureMachine:
    def __init__(self):
        self.reset()

    def reset(self):
        self.last_sample_ms = None
        self.last_hand = None
        self.active_index = None
        self.extended_at = None
        self.index_reference = None
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

        if len(hands) == 2 and all(all(hand.fingers) for hand in hands):
            first, second = hands
            self.last_sample_ms = captured_at_ms
            self.last_hand = None
            self.active_index = None
            separation = dist(first.center, second.center)
            return self._motion("zoom", (separation, 0), (first.width + second.width) / 2, captured_at_ms)

        active = 0
        if len(hands) == 2:
            candidates = [i for i, hand in enumerate(hands) if self._can_control_pair(hand, captured_at_ms)]
            if len(candidates) != 1:
                self.reset()
                return "idle"
            active = candidates[0]

        hand = hands[active]
        if self.last_hand is not None and not self._same_hand(hand):
            self.reset()
        self.last_sample_ms = captured_at_ms
        self.last_hand = hand
        self.active_index = active

        if len(hands) == 1 and all(hand.fingers) and hand.facing_camera:
            return self._motion("pan", hand.center, hand.width, captured_at_ms)
        if sum(hand.fingers) == 2:
            return self._motion("rotate", hand.center, hand.width, captured_at_ms)

        self.control = "idle"
        if hand.fingers == INDEX_ONLY or not any(hand.fingers):
            return self._index_gesture(hand, captured_at_ms)

        self.reset()
        return "idle"

    def _same_hand(self, hand):
        previous = self.last_hand
        return (previous is not None and hand.side == previous.side
                and dist(hand.center, previous.center) <= 1.5 * max(hand.width, previous.width))

    def _can_control_pair(self, hand, now):
        if hand.fingers == INDEX_ONLY or sum(hand.fingers) == 2:
            return True

        # A curled index can complete a click only for the hand that armed it.
        return (not any(hand.fingers) and self.extended_at is not None
                and now - self.extended_at <= BEND_WINDOW_MS and self._same_hand(hand))

    def _index_gesture(self, hand, now):
        # Compare each joint against the pointing pose. The distal joint can start
        # noticeably bent while the hand still looks like it is pointing.
        bend = 0.0
        if self.index_reference is not None:
            bend = max(angle - reference for angle, reference in zip(hand.index_angles, self.index_reference))
        click_pose = bend >= BEND_TRIGGER_DEGREES or (not hand.fingers[1] and hand.index_bent)
        if self.extended_at is not None and now - self.extended_at <= BEND_WINDOW_MS and click_pose:
            self.extended_at = None
            return "select"

        if hand.fingers[1] and bend < BEND_START_DEGREES and not click_pose:
            if hand.index_straight:
                if self.index_reference is None:
                    self.index_reference = hand.index_angles
                self.extended_at = now
            return "cursor"

        return "idle"

    def _motion(self, control, position, width, now):
        self.extended_at = None
        self.index_reference = None
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
