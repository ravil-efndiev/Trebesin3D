import json
import os
import socket
import threading
import time
import unittest
from contextlib import ExitStack
from io import BytesIO
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from PIL import Image
from uvicorn import Config, Server
from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.sync.client import connect

from src.api.v1.protocol import MAX_PACKET_BYTES
from src.main import create_app


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

    def start_stream(self, websocket):
        websocket.send(json.dumps({"type": "stream:start", "requestId": "start", "protocolVersion": 1}))
        response = json.loads(websocket.recv(timeout=2))
        stream_id = response["streamId"]
        self.assertEqual(response, {
            "type": "stream:started", "requestId": "start", "protocolVersion": 1, "streamId": stream_id
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
            self.assertEqual(json.loads(websocket.recv(timeout=2))["frameId"], 2)
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
