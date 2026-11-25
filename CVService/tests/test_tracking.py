import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image, ImageOps

from src.gestures import GestureMachine
from src.tracking import HandTracker
from tests.test_gestures import hand_joints


FIXTURE = Path(__file__).resolve().parents[2] / "tests/fixtures/pointing_up.jpg"


def candidate(scale, side, fingers, center=0.5):
    world = hand_joints(fingers, side)
    points = [SimpleNamespace(x=center + x * scale, y=0.5 + y * scale / 0.75, z=z)
              for x, y, z in world]
    return points, [SimpleNamespace(x=x, y=y, z=z) for x, y, z in world], [SimpleNamespace(category_name=side, score=0.99)]


class ForegroundTests(unittest.TestCase):
    def setUp(self):
        self.tracker = HandTracker()
        self.addCleanup(self.tracker.close)
        self.gestures = GestureMachine()

    def test_background_slots_give_way_to_a_new_pointing_hand(self):
        with Image.open(FIXTURE) as source, Image.new("RGB", (640, 480)) as background:
            distant = source.resize((122, 128))
            background.paste(distant, (10, 20))
            background.paste(ImageOps.mirror(distant), (420, 220))
            self.assertEqual(len(self.tracker._infer(background).hand_landmarks), 2)
            self.assertEqual(self.tracker.detect(background), [])

            scene = background.copy()
            scene.paste(source.resize((286, 301)), (170, 10))
            results = [self.tracker.detect_gestures(scene, self.gestures, i * 60) for i in range(6)]
            for hands, gesture in results[-3:]:
                self.assertEqual((len(hands), gesture), (1, "cursor"))
                self.assertAlmostEqual(hands[0]["landmarks"][0][0], 0.48, delta=0.05)

            hands, gesture = self.tracker.detect_gestures(background, self.gestures, 360)
            self.assertEqual((hands, gesture), ([], "idle"))

    def test_second_foreground_hand_replaces_background_then_releases_to_one_hand(self):
        with Image.open(FIXTURE) as source:
            primary = source.resize((297, 312))
            distant = ImageOps.mirror(source.resize((204, 214)))
            secondary = ImageOps.mirror(source.resize((283, 297)))

        now = 0
        for show_primary, show_distant, show_secondary, wrists, gesture in [
            (True, False, False, [0.22], "cursor"),
            (True, True, False, [0.22], "cursor"),
            (True, True, True, [0.22, 0.61], "idle"),
            (True, True, False, [0.22], "cursor"),
            (False, True, False, [], "idle"),
        ]:
            with Image.new("RGB", (640, 480)) as scene:
                if show_primary:
                    scene.paste(primary, (0, 0))
                if show_distant:
                    scene.paste(distant, (378, 10))
                if show_secondary:
                    scene.paste(secondary, (240, 185))

                for sample in range(6):
                    hands, observed = self.tracker.detect_gestures(scene, self.gestures, now)
                    now += 55
                    # Allow two samples for a newly visible ROI to settle.
                    if sample >= 2:
                        self.assertEqual(observed, gesture)
                        positions = sorted(hand["landmarks"][0][0] for hand in hands)
                        self.assertEqual(len(positions), len(wrists))
                        for x, expected in zip(positions, wrists):
                            self.assertAlmostEqual(x, expected, delta=0.04)

    def test_relative_size_keeps_pose_and_handedness_paired_in_either_order(self):
        near = candidate(2.0, "Left", range(5))
        smaller = candidate(1.1, "Right", [1])
        peer = candidate(1.7, "Right", range(5))
        distant_open = candidate(1.4, "Right", range(5))
        same_side = candidate(1.9, "Left", range(5))
        with Image.new("RGB", (640, 480)) as image:
            for candidates, expected in [([smaller], "cursor"), ([smaller, near], "pan_ready"),
                                         ([near, smaller], "pan_ready"), ([near, distant_open], "pan_ready"),
                                         ([near, distant_open, peer], "zoom_ready"),
                                         ([same_side, near], "pan_ready"), ([near, peer], "zoom_ready")]:
                points, world, sides = zip(*candidates)
                result = SimpleNamespace(hand_landmarks=points, hand_world_landmarks=world, handedness=sides)
                self.gestures.reset()
                with patch.object(self.tracker, "_infer", return_value=result):
                    hands, gesture = self.tracker.detect_gestures(image, self.gestures, 0)
                self.assertEqual(gesture, expected)
                self.assertEqual(len(hands), 2 if expected == "zoom_ready" else 1)

    def test_cursor_hand_is_first_in_result_and_both_hands_are_visible(self):
        passive = candidate(1.9, "Right", range(5), 0.28)
        pointing = candidate(2.0, "Left", [1], 0.72)
        with Image.new("RGB", (640, 480)) as image:
            for frame, candidates in enumerate(([passive, pointing], [pointing, passive])):
                points, world, sides = zip(*candidates)
                result = SimpleNamespace(hand_landmarks=points, hand_world_landmarks=world, handedness=sides)
                with patch.object(self.tracker, "_infer", return_value=result):
                    hands, gesture = self.tracker.detect_gestures(image, self.gestures, frame * 55)
                self.assertEqual(gesture, "cursor")
                self.assertEqual([hand["landmarks"][0][0] for hand in hands], [0.72, 0.28])

    def test_background_open_palm_cannot_trigger_or_sustain_zoom(self):
        primary = candidate(2.0, "Left", range(5), 0.30)
        distant = candidate(1.4, "Right", range(5), 0.80)
        peer = candidate(1.9, "Right", range(5), 0.55)
        moving_peer = candidate(1.9, "Right", range(5), 0.62)
        sequence = [
            ([primary], "pan_ready"),
            ([distant, primary], "pan_ready"),
            ([primary, distant, peer], "zoom_ready"),
            ([moving_peer, primary, distant], "zoom_in"),
            ([distant, primary], "pan_ready"),
            ([primary], "pan_ready"),
            ([distant], "idle"),
        ]
        with Image.new("RGB", (640, 480)) as image:
            for frame, (candidates, expected) in enumerate(sequence):
                points, world, sides = zip(*candidates)
                result = SimpleNamespace(hand_landmarks=points, hand_world_landmarks=world, handedness=sides)
                with patch.object(self.tracker, "_infer", return_value=result):
                    hands, gesture = self.tracker.detect_gestures(image, self.gestures, frame * 55)
                self.assertEqual(gesture, expected)
                self.assertTrue(all(hand["landmarks"][0][0] < 0.70 for hand in hands))
