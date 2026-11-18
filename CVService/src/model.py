"""Install and verify the fixed MediaPipe float16 Hand Landmarker v1 bundle."""
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.request import urlopen


MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "hand_landmarker.task"
MODEL_SIZE = 7819105
MODEL_SHA256 = "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1"


def verified_bytes(source) -> bytes:
    data = source.read(MODEL_SIZE + 1)
    if len(data) != MODEL_SIZE or sha256(data).hexdigest() != MODEL_SHA256:
        raise ValueError("Hand Landmarker model failed verification.")

    return data


def read_model() -> bytes:
    with MODEL_PATH.open("rb") as source:
        return verified_bytes(source)


def install_model():
    if MODEL_PATH.exists():
        read_model()
        return

    with urlopen(MODEL_URL, timeout=60) as source:
        data = verified_bytes(source)

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=MODEL_PATH.parent) as staging:
        temporary = Path(staging) / MODEL_PATH.name
        temporary.write_bytes(data)
        temporary.replace(MODEL_PATH)


if __name__ == "__main__":
    install_model()
    print("Verified Hand Landmarker model is ready.")
