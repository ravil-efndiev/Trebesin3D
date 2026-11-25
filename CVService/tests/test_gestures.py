import unittest
from math import cos, radians, sin

from src.gestures import GestureMachine, classify_hand


def hand_joints(fingers, side="Right", back=False, index_offsets=None):
    # Joint chains in meters, with the wrist below the knuckles in camera axes.
    world = [(0, 0.075, 0)]
    if 0 in fingers:
        world += [(0.04, 0.05, 0), (0.06, 0.035, 0), (0.085, 0.02, 0), (0.11, 0.005, 0)]
    else:
        world += [(0.04, 0.05, 0), (0.06, 0.03, 0), (0.05, 0.018, 0), (0.026, 0.018, 0)]
    for finger, knuckle_x in enumerate((0.04, 0.012, -0.015, -0.04), 1):
        offsets = (0, -0.025, -0.047, -0.065) if finger in fingers else (0, -0.025, 0.01, 0.025)
        if finger == 1 and index_offsets is not None:
            world.extend((knuckle_x, y, z) for y, z in index_offsets)
        else:
            world.extend((knuckle_x, offset, 0) for offset in offsets)

    if (side == "Left") != back:
        world = [(-a, b, c) for a, b, c in world]
    return world


def hand(fingers, x=0.5, y=0.5, side="Right", back=False, index_offsets=None):
    world = hand_joints(fingers, side, back, index_offsets)
    points = [(x + a, y + b / 0.75, c) for a, b, c in world]
    return classify_hand(world, points, side, 0.75)


OPEN = range(5)


def index_hinge(joint, angle):
    y = z = 0.0
    points = [(y, z)]
    for segment, length in enumerate((0.025, 0.022, 0.018), 1):
        tilt = radians(angle) if segment >= joint else 0
        y -= length * cos(tilt)
        z -= length * sin(tilt)
        points.append((y, z))
    return points


PARTIAL_INDEX = index_hinge(2, 19)
BENT_INDEX = index_hinge(2, 32)


class GestureTests(unittest.TestCase):
    def setUp(self):
        self.machine = GestureMachine()

    def test_index_only_and_exactly_two_of_any_fingers(self):
        self.assertEqual(self.machine.update([hand([1])], 0), "cursor")
        for first in range(5):
            for second in range(first + 1, 5):
                self.machine.reset()
                with self.subTest(first=first, second=second):
                    self.assertEqual(self.machine.update([hand([first, second])], 0), "rotate_ready")
        for fingers in ([0], [2], [1, 2, 3], []):
            self.assertEqual(self.machine.update([hand(fingers)], 50), "idle")

    def test_pan_is_mirrored_and_requires_a_front_facing_palm(self):
        for side in ("Right", "Left"):
            for x, y, direction in ((0.53, 0.5, "left"), (0.47, 0.5, "right"),
                                    (0.5, 0.45, "up"), (0.5, 0.55, "down")):
                self.machine.reset()
                self.assertEqual(self.machine.update([hand(OPEN, side=side)], 0), "pan_ready")
                self.assertEqual(self.machine.update([hand(OPEN, x, y, side)], 60), "pan_" + direction)
                self.assertEqual(self.machine.update([hand(OPEN, x, y, side)], 180), "pan_ready")
                self.assertEqual(self.machine.update([hand(OPEN, side=side, back=True)], 230), "idle")

    def test_jitter_vertical_rotation_and_mode_switch_do_not_start_movement(self):
        update = self.machine.update
        self.assertEqual(update([hand(OPEN)], 0), "pan_ready")
        self.assertEqual(update([hand(OPEN, 0.502)], 60), "pan_ready")
        self.assertEqual(update([hand([1, 2], 0.55)], 120), "rotate_ready")
        self.assertEqual(update([hand([1, 2], 0.55, 0.58)], 180), "rotate_ready")
        self.assertEqual(update([hand([1, 2], 0.52, 0.58)], 240), "rotate_right")
        self.assertEqual(update([hand([1, 2], 0.56, 0.58)], 300), "rotate_left")
        self.assertEqual(update([hand(OPEN, 0.58)], 360), "pan_ready")

    def test_zoom_is_independent_of_hand_order_and_common_translation(self):
        pair = [hand(OPEN, 0.3), hand(OPEN, 0.7, side="Left")]
        update = self.machine.update
        self.assertEqual(update(pair, 0), "zoom_ready")
        self.assertEqual(update(pair[::-1], 60), "zoom_ready")
        self.assertEqual(update([hand(OPEN, 0.4), hand(OPEN, 0.8, side="Left")], 120), "zoom_ready")
        self.assertEqual(update([hand(OPEN, 0.25), pair[1]], 180), "zoom_in")
        self.assertEqual(update(pair, 240), "zoom_out")
        self.assertEqual(update([pair[0], hand([1], 0.7)], 300), "cursor")
        self.assertEqual(update(pair, 360), "zoom_ready")

    def test_pair_follows_only_the_rotating_hand_across_order_changes(self):
        update = self.machine.update
        fixed = hand([1, 2], 0.30)
        self.assertEqual(update([hand(OPEN, side="Left"), fixed], 0), "rotate_ready")
        self.assertEqual(update([fixed, hand(OPEN, 0.75, side="Left")], 60), "rotate_ready")
        self.assertEqual(update([hand(OPEN, side="Left"), hand([1, 2], 0.33)], 120), "rotate_left")
        self.assertEqual(update([hand(OPEN), hand(OPEN, side="Left")], 180), "zoom_ready")
        self.assertEqual(update([fixed, hand([1], side="Left")], 240), "idle")

    def test_index_bend_with_a_second_hand_visible_selects_once(self):
        palm = hand(OPEN, 0.8, side="Left")
        update = self.machine.update
        self.assertEqual(update([palm, hand([1])], 0), "cursor")
        self.assertEqual(update([hand([], index_offsets=PARTIAL_INDEX), palm], 60), "idle")
        self.assertEqual(update([palm, hand([])], 120), "select")
        self.assertEqual(update([hand([]), palm], 180), "idle")

    def test_select_is_a_fast_bend_edge_with_extension_required_to_rearm(self):
        sequence = [([1], "cursor"), ([], "select"), ([], "idle"), ([1], "cursor"), ([], "select")]
        for i, (fingers, result) in enumerate(sequence):
            self.assertEqual(self.machine.update([hand(fingers)], i * 60), result)

        partial = hand([], index_offsets=PARTIAL_INDEX)
        self.assertEqual(self.machine.update([hand([1])], 300), "cursor")
        for t in (360, 420, 480, 540):
            self.assertEqual(self.machine.update([partial], t), "idle")
        self.assertEqual(self.machine.update([hand([])], 590), "idle")

    def test_index_can_bend_in_depth_across_intermediate_frames(self):
        partial = hand([], index_offsets=PARTIAL_INDEX)
        bent = hand([], index_offsets=BENT_INDEX)
        self.assertFalse(partial.index_bent)
        self.assertFalse(bent.index_bent)
        self.assertTrue(bent.fingers[1])
        self.assertEqual(self.machine.update([hand([1])], 0), "cursor")
        self.assertEqual(self.machine.update([partial], 70), "idle")
        self.assertEqual(self.machine.update([partial], 140), "idle")
        self.assertEqual(self.machine.update([bent], 210), "select")
        self.assertEqual(self.machine.update([bent], 280), "idle")

    def test_distal_joint_alone_clicks_relative_to_a_curved_pointing_pose(self):
        pointing = hand([], index_offsets=index_hinge(3, 30))
        jitter = hand([], index_offsets=index_hinge(3, 38))
        bent = hand([], index_offsets=index_hinge(3, 57))
        for i, (pose, expected) in enumerate(((pointing, "cursor"), (jitter, "cursor"), (bent, "select"),
                                               (bent, "idle"), (pointing, "cursor"), (bent, "select"))):
            self.assertEqual(self.machine.update([pose], i * 60), expected)

    def test_loss_stale_sample_and_hand_substitution_cancel_actions(self):
        for lost in ([], [None], [hand([1]), hand([1, 2])]):
            self.machine.update([hand([1])], 0)
            self.assertEqual(self.machine.update(lost, 60), "idle")
            self.assertEqual(self.machine.update([hand([])], 120), "idle")
        self.machine.update([hand([1])], 180)
        self.assertEqual(self.machine.update([hand([], side="Left")], 240), "idle")
        self.machine.update([hand(OPEN)], 300)
        self.assertEqual(self.machine.update([hand(OPEN, 0.56)], 500), "pan_ready")
        self.machine.update([hand([1])], 560)
        self.assertEqual(self.machine.update([hand([], 0.1)], 620), "idle")

    def test_streams_do_not_share_selection_or_motion_state(self):
        other = GestureMachine()
        self.machine.update([hand([1])], 0)
        self.assertEqual(other.update([hand([])], 50), "idle")
        self.assertEqual(self.machine.update([hand([])], 50), "select")
