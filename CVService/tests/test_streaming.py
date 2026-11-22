import json
import os
import socket
import threading
import time
import unittest
from contextlib import ExitStack
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from PIL import Image
from uvicorn import Config, Server
from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.sync.client import connect

from src.api.v1.protocol import MAX_PACKET_BYTES
from src.main import create_app
from src.tracking import HandTracker
from tests.test_gestures import BENT_INDEX, PARTIAL_INDEX, hand_joints


ORIGIN = "http://127.0.0.1:5173"


def jpeg_bytes():
    buffer = BytesIO()
    with Image.new("RGB", (16, 12), "blue") as image:
        image.save(buffer, format="JPEG")
    return buffer.getvalue()


def packet(stream_id, frame_id=1, jpeg=None, **overrides):
    header = json.dumps({
        "type": "stream:frame", "protocolVersion": 1, "streamId": stream_id, "frameId": frame_id,
        "capturedAtMs": frame_id * 70, "width": 16, "height": 12, "mimeType": "image/jpeg", **overrides,
    }).encode()
    return len(header).to_bytes(4, "big") + header + (jpeg_bytes() if jpeg is None else jpeg)


class StreamingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = str(uuid4())
        with patch.dict(os.environ, {"CV_SERVICE_API_KEY": cls.key, "CV_ALLOWED_ORIGINS": ORIGIN}):
            app = create_app()

        listener = socket.create_server(("127.0.0.1", 0))
        cls.addClassCleanup(listener.close)
        cls.address = f"127.0.0.1:{listener.getsockname()[1]}"
        server = Server(Config(
            app, ws="websockets", ws_max_size=MAX_PACKET_BYTES, ws_max_queue=1,
            ws_per_message_deflate=False, proxy_headers=False, log_level="error",
        ))
        thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)

        def shutdown():
            server.should_exit = True
            thread.join(timeout=5)

        cls.addClassCleanup(shutdown)
        thread.start()
        deadline = time.monotonic() + 5
        while not server.started:
            if not thread.is_alive() or time.monotonic() >= deadline:
                raise RuntimeError("Test server failed to start.")
            time.sleep(0.01)

    def health(self, **options):
        request = Request(f"http://{self.address}/api/health/", **options)
        try:
            return urlopen(request, timeout=2)
        except HTTPError as error:
            return error

    def websocket(self, *, origin=ORIGIN, headers=None):
        return connect(
            f"ws://{self.address}/api/v1/stream", origin=origin,
            additional_headers=headers if headers is not None else {"x-api-key": self.key}, open_timeout=2,
        )

    def start_stream(self, websocket, version=1):
        websocket.send(json.dumps({"type": "stream:start", "requestId": "start", "protocolVersion": version}))
        response = json.loads(websocket.recv(timeout=2))
        stream_id = response["streamId"]
        self.assertEqual(response, {
            "type": "stream:started", "requestId": "start", "protocolVersion": version, "streamId": stream_id
        })
        return stream_id

    def test_single_jpeg_required_for_receipt(self):
        with Image.new("RGB", (16, 12)) as picture, BytesIO() as buffer, self.websocket() as ws:
            picture.save(buffer, format="MPO", save_all=True, append_images=[picture])
            stream = self.start_stream(ws)
            ws.send(packet(stream, jpeg=buffer.getvalue()))
            self.assertEqual(json.loads(ws.recv(timeout=2)), {
                "type": "stream:error", "code": "INVALID_FRAME", "message": "JPEG validation failed.",
                "fatal": False, "streamId": stream, "frameId": 1,
            })
            ws.send(packet(stream, 2))
            self.assertEqual(json.loads(ws.recv(timeout=2)), {"type": "frame:ack", "streamId": stream, "frameId": 2})

    def test_timed_out_decode_retains_slot_until_worker_exits(self):
        self.check_decode_capacity(disconnect_early=False)

    def test_disconnect_during_decode_retains_slot_until_worker_exits(self):
        self.check_decode_capacity(disconnect_early=True)

    def check_decode_capacity(self, *, disconnect_early):
        entered = threading.Event()
        finish = threading.Event()
        convert = Image.Image.convert

        def delayed_decode(image, *args, **kwargs):
            entered.set()
            finish.wait(timeout=5)
            return convert(image, *args, **kwargs)

        with ExitStack() as clients:
            for _ in range(3):
                clients.enter_context(self.websocket())

            with patch("src.api.v1.websocket.FRAME_TIMEOUT", 0.1), patch.object(Image.Image, "convert", delayed_decode):
                try:
                    with self.websocket() as ws:
                        stream = self.start_stream(ws)
                        ws.send(packet(stream))
                        self.assertTrue(entered.wait(timeout=1))
                        if not disconnect_early:
                            response = json.loads(ws.recv(timeout=1))
                            self.assertEqual(response, {
                                "type": "stream:error", "code": "FRAME_TIMEOUT", "message": "Frame processing timed out.",
                                "fatal": True, "streamId": stream, "frameId": 1,
                            })
                    with self.assertRaises(InvalidStatus):
                        self.websocket()
                finally:
                    finish.set()

            deadline = time.monotonic() + 1
            while True:
                try:
                    with self.websocket() as ws:
                        self.start_stream(ws)
                    break
                except InvalidStatus:
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(0.01)

    def test_health_requires_key_and_allows_trusted_preflight(self):
        with self.health(headers={"Origin": ORIGIN, "x-api-key": self.key}) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], ORIGIN)
            self.assertEqual(json.load(response), {"status": "ok"})

        for key in (None, str(uuid4())):
            headers = {"Origin": ORIGIN}
            if key:
                headers["x-api-key"] = key
            with self.health(headers=headers) as response:
                self.assertEqual(response.status, 401)
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], ORIGIN)

        for origin, status in ((ORIGIN, 200), ("http://other.example", 400)):
            with self.health(method="OPTIONS", headers={
                "Origin": origin, "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "x-api-key",
            }) as response:
                self.assertEqual(response.status, status)
                self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), ORIGIN if status == 200 else None)

    def test_upgrade_requires_key_and_origin(self):
        for origin, headers in (
            (ORIGIN, {}), (ORIGIN, {"x-api-key": str(uuid4())}),
            (ORIGIN, [("x-api-key", self.key), ("X-API-Key", self.key)]),
            (None, None), ("null", None), ("http://other.example", None),
        ):
            with self.subTest(origin=origin, header_count=len(headers or {})):
                with self.assertRaises(InvalidStatus) as caught:
                    self.websocket(origin=origin, headers=headers)
                self.assertEqual(caught.exception.response.status_code, 403)

    def test_receipts_jpeg_rejections_stop_and_restart(self):
        with self.websocket() as websocket:
            stream_id = self.start_stream(websocket)
            websocket.send(packet(stream_id, width=17))
            self.assertEqual(json.loads(websocket.recv(timeout=2)), {
                "type": "stream:error", "code": "INVALID_FRAME", "message": "JPEG validation failed.",
                "fatal": False, "streamId": stream_id, "frameId": 1,
            })
            websocket.send(packet(stream_id, 2, jpeg=b"\xff\xd8garbage\xff\xd9"))
            self.assertEqual(json.loads(websocket.recv(timeout=2)), {
                "type": "stream:error", "code": "INVALID_FRAME", "message": "JPEG validation failed.",
                "fatal": False, "streamId": stream_id, "frameId": 2,
            })
            websocket.send(packet(stream_id, 3))
            self.assertEqual(json.loads(websocket.recv(timeout=2)), {
                "type": "frame:ack", "streamId": stream_id, "frameId": 3,
            })
            time.sleep(0.06)
            websocket.send(json.dumps({"type": "stream:stop", "requestId": "stop", "streamId": stream_id}))
            self.assertEqual(json.loads(websocket.recv(timeout=2)), {
                "type": "stream:stopped", "requestId": "stop", "streamId": stream_id,
            })
            time.sleep(0.06)
            self.assertNotEqual(self.start_stream(websocket), stream_id)

    def test_multiple_picture_jpeg_is_rejected_before_tracking(self):
        with Image.new("RGB", (16, 12)) as picture, BytesIO() as buffer, self.websocket() as websocket:
            picture.save(buffer, format="MPO", save_all=True, append_images=[picture.copy()])
            stream_id = self.start_stream(websocket, 2)
            websocket.send(packet(stream_id, jpeg=buffer.getvalue(), protocolVersion=2))
            response = json.loads(websocket.recv(timeout=2))
            self.assertEqual((response["code"], response["fatal"], response["frameId"]), ("INVALID_FRAME", False, 1))

    def test_invalid_messages_close_without_a_receipt(self):
        for invalid in (
            lambda _stream: b"\x00\x00\x04\x01x",
            lambda stream: packet(stream, capturedAtMs=float("inf")),
            lambda stream: packet(stream, frameId=True),
            lambda stream: packet(stream, protocolVersion=2),
            lambda _stream: packet("another-stream"),
        ):
            with self.websocket() as websocket:
                stream_id = self.start_stream(websocket)
                websocket.send(invalid(stream_id))
                response = json.loads(websocket.recv(timeout=2))
                self.assertEqual(response["type"], "stream:error")
                self.assertTrue(response["fatal"])
                with self.assertRaises(ConnectionClosed):
                    websocket.recv(timeout=2)

    def test_tracking_follows_movement_and_clears_on_blank_frame(self):
        fixture = Path(__file__).resolve().parents[2] / "tests/fixtures/pointing_up.jpg"
        with self.websocket() as websocket, Image.open(fixture) as hand:
            stream = self.start_stream(websocket, 2)
            wrist_positions = []
            for frame_id, offset in enumerate((30, 110, None), start=1):
                with Image.new("RGB", (640, 480)) as scene:
                    if offset is not None:
                        scene.paste(hand, (offset, 40))
                    buffer = BytesIO()
                    scene.save(buffer, format="JPEG")

                websocket.send(packet(
                    stream, frame_id, buffer.getvalue(), width=640, height=480, protocolVersion=2,
                ))
                result = json.loads(websocket.recv(timeout=2))
                hands = result.pop("hands")
                self.assertEqual(result, {"type": "tracking:result", "streamId": stream, "frameId": frame_id})
                if offset is None:
                    self.assertEqual(hands, [])
                    continue

                self.assertEqual(len(hands), 1)
                landmarks = hands[0]["landmarks"]
                self.assertEqual(len(landmarks), 21)
                for point in landmarks:
                    self.assertEqual(len(point), 3)
                    self.assertTrue(all(abs(value) <= 8 for value in point))
                wrist_positions.append(landmarks[0][0])

            self.assertAlmostEqual(wrist_positions[1] - wrist_positions[0], 80 / 640, delta=0.05)

    def test_v3_reports_cursor_for_real_index_pose_and_idle_on_loss(self):
        fixture = Path(__file__).resolve().parents[2] / "tests/fixtures/pointing_up.jpg"
        with self.websocket() as websocket, Image.open(fixture) as hand:
            stream = self.start_stream(websocket, 3)
            for frame_id, expected in enumerate(("cursor", "idle", "cursor"), start=1):
                with Image.new("RGB", (640, 480)) as scene, BytesIO() as buffer:
                    if expected == "cursor":
                        scene.paste(hand, (30, 40))
                    scene.save(buffer, format="JPEG")
                    websocket.send(packet(stream, frame_id, buffer.getvalue(), width=640, height=480, protocolVersion=3))

                response = json.loads(websocket.recv(timeout=2))
                self.assertEqual((response["type"], response["streamId"], response["frameId"]),
                                 ("tracking:result", stream, frame_id))
                self.assertEqual(response["gesture"], expected)
                self.assertEqual(len(response["hands"]), int(expected == "cursor"))

    def test_v3_transmits_select_after_a_sampled_bend(self):
        fixture = Path(__file__).resolve().parents[2] / "tests/fixtures/pointing_up.jpg"
        infer = HandTracker._infer
        pointing = None
        steps = iter((None, PARTIAL_INDEX, PARTIAL_INDEX, BENT_INDEX, BENT_INDEX))

        def infer_sequence(tracker, image):
            nonlocal pointing
            offsets = next(steps)
            if offsets is None:
                pointing = infer(tracker, image)
                return pointing
            side = pointing.handedness[0][0].category_name
            joints = hand_joints([], side=side, index_offsets=offsets)
            return SimpleNamespace(
                handedness=pointing.handedness, hand_landmarks=pointing.hand_landmarks,
                hand_world_landmarks=[[SimpleNamespace(x=x, y=y, z=z) for x, y, z in joints]],
            )

        with Image.open(fixture) as hand, Image.new("RGB", (640, 480)) as scene, BytesIO() as buffer:
            scene.paste(hand, (30, 40))
            scene.save(buffer, format="JPEG")
            jpeg = buffer.getvalue()

        with patch.object(HandTracker, "_infer", infer_sequence), self.websocket() as websocket:
            stream = self.start_stream(websocket, 3)
            for frame_id, expected in enumerate(("cursor", "idle", "idle", "select", "idle"), start=1):
                time.sleep(0.07)
                websocket.send(packet(stream, frame_id, jpeg, width=640, height=480, protocolVersion=3))
                response = json.loads(websocket.recv(timeout=2))
                self.assertEqual(response["type"], "tracking:result", response)
                self.assertEqual((response["streamId"], response["frameId"], response["gesture"]),
                                 (stream, frame_id, expected))

    def test_v2_trackers_are_isolated_and_closed_on_stop_and_disconnect(self):
        with patch("src.api.v1.websocket.HandTracker") as factory:
            trackers = [Mock(), Mock(), Mock()]
            factory.side_effect = trackers
            with self.websocket() as first, self.websocket() as second:
                stream = self.start_stream(first, 2)
                self.start_stream(second, 2)
                first.send(json.dumps({"type": "stream:stop", "requestId": "s", "streamId": stream}))
                self.assertEqual(json.loads(first.recv(timeout=2))["type"], "stream:stopped")
                trackers[0].close.assert_called_once()
                trackers[1].close.assert_not_called()
                self.assertNotEqual(self.start_stream(first, 2), stream)

            deadline = time.monotonic() + 2
            while not all(tracker.close.called for tracker in trackers) and time.monotonic() < deadline:
                time.sleep(0.01)
            for tracker in trackers:
                tracker.close.assert_called_once()

    def test_tracker_setup_failure_has_request_id(self):
        with patch("src.api.v1.websocket.HandTracker", side_effect=ValueError("invalid model")), self.websocket() as ws:
            ws.send(json.dumps({"type": "stream:start", "requestId": "s", "protocolVersion": 2}))
            message = json.loads(ws.recv(timeout=2))
            self.assertEqual((message["code"], message["fatal"], message["requestId"]), ("TRACKER_UNAVAILABLE", True, "s"))

    def test_timed_out_work_keeps_capacity_until_it_finishes(self):
        finish = threading.Event()
        entered = threading.Event()

        def slow_process(_processor, _frame):
            entered.set()
            finish.wait(timeout=5)

        with patch("src.api.v1.websocket.FRAME_TIMEOUT", 0.1), patch("src.api.v1.websocket.StreamProcessor.process", slow_process):
            with ExitStack() as clients:
                for _ in range(3):
                    clients.enter_context(self.websocket())

                with self.websocket() as ws:
                    stream = self.start_stream(ws)
                    ws.send(packet(stream))
                    self.assertTrue(entered.wait(timeout=1))
                    self.assertEqual(json.loads(ws.recv(timeout=2))["code"], "FRAME_TIMEOUT")

                try:
                    with self.assertRaises(InvalidStatus):
                        self.websocket()
                finally:
                    finish.set()

                deadline = time.monotonic() + 2
                while True:
                    try:
                        with self.websocket() as ws:
                            self.start_stream(ws)
                            break
                    except InvalidStatus:
                        if time.monotonic() >= deadline:
                            raise
                        time.sleep(0.01)

    def test_transport_rejects_oversize(self):
        with self.websocket() as websocket:
            websocket.send(b"x" * (MAX_PACKET_BYTES + 1))
            with self.assertRaises(ConnectionClosed) as caught:
                websocket.recv(timeout=2)
            self.assertEqual(caught.exception.rcvd.code, 1009)

    def test_capacity_returns_after_disconnect(self):
        with ExitStack() as clients:
            for _ in range(4):
                clients.enter_context(self.websocket())
            with self.assertRaises(InvalidStatus):
                self.websocket()

        deadline = time.monotonic() + 2
        while True:
            try:
                with self.websocket() as websocket:
                    self.start_stream(websocket)
                    break
            except InvalidStatus:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.01)
