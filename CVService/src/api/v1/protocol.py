import json
import sys
from dataclasses import dataclass
from io import BytesIO

from PIL import Image


MAX_TEXT_BYTES = 4096
MAX_HEADER_BYTES = 1024
MAX_JPEG_BYTES = 262144
MAX_PACKET_BYTES = 4 + MAX_HEADER_BYTES + MAX_JPEG_BYTES
MAX_FRAME_ID = 2**53 - 1
MAX_WIDTH = 640
MAX_HEIGHT = 480


class ProtocolError(ValueError):
    pass


@dataclass(frozen=True)
class Frame:
    stream_id: str
    frame_id: int
    captured_at_ms: float
    width: int
    height: int
    jpeg: bytes


def is_id(value: object) -> bool:
    if not isinstance(value, str) or not 1 <= len(value) <= 64:
        return False

    try:
        return len(value.encode("utf-16-le")) <= 128
    except UnicodeError:
        return False


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ProtocolError("Duplicate JSON field.")
        result[key] = value

    return result


def invalid_number(_value):
    raise ProtocolError("Invalid JSON number.")


def parse_object(text: str) -> dict:
    try:
        value = json.loads(text, object_pairs_hook=unique_object, parse_constant=invalid_number)
    except (ValueError, RecursionError) as error:
        raise ProtocolError("Invalid JSON object.") from error

    if not isinstance(value, dict):
        raise ProtocolError("Expected a JSON object.")

    return value


def is_version(value: object) -> bool:
    return type(value) in (int, float) and value in (1, 2)


def read_frame(packet: bytes, version: int) -> Frame:
    if not 6 <= len(packet) <= MAX_PACKET_BYTES:
        raise ProtocolError("Invalid frame size.")

    header_size = int.from_bytes(packet[:4], "big")
    jpeg_offset = 4 + header_size
    if not 1 <= header_size <= MAX_HEADER_BYTES or not 1 <= len(packet) - jpeg_offset <= MAX_JPEG_BYTES:
        raise ProtocolError("Invalid frame header or JPEG length.")

    try:
        header = parse_object(packet[4:jpeg_offset].decode("utf-8"))
    except UnicodeError as error:
        raise ProtocolError("Invalid UTF-8 frame header.") from error

    expected_fields = {"type", "protocolVersion", "streamId", "frameId", "capturedAtMs", "width", "height", "mimeType"}
    if (
        set(header) != expected_fields or header["type"] != "stream:frame"
        or not is_version(header["protocolVersion"]) or header["protocolVersion"] != version
    ):
        raise ProtocolError("Invalid frame header.")

    stream_id, frame_id, timestamp = header["streamId"], header["frameId"], header["capturedAtMs"]
    width, height = header["width"], header["height"]
    if (
        not is_id(stream_id)
        or type(frame_id) is not int or not 1 <= frame_id <= MAX_FRAME_ID
        or type(timestamp) not in (int, float) or not 0 <= timestamp <= sys.float_info.max
        or type(width) is not int or not 1 <= width <= MAX_WIDTH
        or type(height) is not int or not 1 <= height <= MAX_HEIGHT
        or header["mimeType"] != "image/jpeg"
    ):
        raise ProtocolError("Invalid frame metadata.")

    return Frame(stream_id, frame_id, float(timestamp), width, height, packet[jpeg_offset:])


def decode_jpeg(frame: Frame) -> Image.Image | None:
    if not frame.jpeg.startswith(b"\xff\xd8") or not frame.jpeg.endswith(b"\xff\xd9"):
        return None

    try:
        with Image.open(BytesIO(frame.jpeg), formats=("JPEG",)) as image:
            if getattr(image, "n_frames", 1) != 1:
                return None
            if image.format != "JPEG" or image.size != (frame.width, frame.height):
                return None

            return image.convert("RGB")
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError):
        return None
