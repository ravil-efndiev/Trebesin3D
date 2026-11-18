import unittest
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from src import model


class ModelTests(unittest.TestCase):
    def test_incomplete_download_is_not_installed(self):
        with TemporaryDirectory() as temporary:
            target = Path(temporary) / "hand_landmarker.task"
            with patch.object(model, "MODEL_PATH", target), patch.object(model, "urlopen", return_value=BytesIO(b"bad")):
                with self.assertRaises(ValueError):
                    model.install_model()
            self.assertFalse(target.exists())

    def test_changed_bytes_fail_verification_even_with_correct_size(self):
        data = bytearray(model.MODEL_SIZE)
        with self.assertRaises(ValueError):
            model.verified_bytes(BytesIO(data))
