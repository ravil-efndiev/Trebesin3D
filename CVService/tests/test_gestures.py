import unittest
from dataclasses import replace

from src.gestures import GestureMachine, classify_hand


def hand(fingers, x=0.5, y=0.5, side="Right", back=False):
    # Joint chains in meters, with the wrist below the knuckles in camera axes.
    world = [(0, 0.075, 0)]
    if 0 in fingers:
        world += [(0.04, 0.05, 0), (0.06, 0.035, 0), (0.085, 0.02, 0), (0.11, 0.005, 0)]
    else:
        world += [(0.04, 0.05, 0), (0.06, 0.03, 0), (0.05, 0.018, 0), (0.026, 0.018, 0)]
    for finger, knuckle_x in enumerate((0.04, 0.012, -0.015, -0.04), 1):
        offsets = (0, -0.025, -0.047, -0.065) if finger in fingers else (0, -0.025, 0.01, 0.025)
        world.extend((knuckle_x, offset, 0) for offset in offsets)

    if (side == "Left") != back:
        world = [(-a, b, c) for a, b, c in world]
    points = [(x + a, y + b / 0.75, c) for a, b, c in world]
    return classify_hand(world, points, side, 0.75)


OPEN = range(5)


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
        self.assertEqual(update([pair[0], hand([1], 0.7)], 300), "idle")
        self.assertEqual(update(pair, 360), "zoom_ready")

    def test_select_is_a_fast_bend_edge_with_extension_required_to_rearm(self):
        sequence = [([1], "cursor"), ([], "select"), ([], "idle"), ([1], "cursor"), ([], "select")]
        for i, (fingers, result) in enumerate(sequence):
            self.assertEqual(self.machine.update([hand(fingers)], i * 60), result)

        partial = replace(hand([]), index_bent=False)
        self.assertEqual(self.machine.update([hand([1])], 300), "cursor")
        for t in (360, 420, 480):
            self.assertEqual(self.machine.update([partial], t), "idle")
        self.assertEqual(self.machine.update([hand([])], 530), "idle")

    def test_loss_stale_sample_and_hand_substitution_cancel_actions(self):
        for lost in ([], [None], [hand([1]), hand([])]):
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
