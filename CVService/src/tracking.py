from math import isfinite
from time import monotonic_ns

import mediapipe as mp
import numpy as np
from PIL import Image

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

    def detect(self, image: Image.Image) -> list[dict]:
        timestamp_ms = max(self.last_timestamp_ms + 1, monotonic_ns() // 1_000_000)
        self.last_timestamp_ms = timestamp_ms
        rgb = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(image))
        result = self.landmarker.detect_for_video(rgb, timestamp_ms)

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

    def close(self):
        self.landmarker.close()
