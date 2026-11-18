import asyncio
from time import monotonic
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ...tracking import HandTracker
from .protocol import MAX_TEXT_BYTES, Frame, ProtocolError, decode_jpeg, is_id, is_version, parse_object, read_frame


stream_router = APIRouter()
START_TIMEOUT = 3
IDLE_TIMEOUT = 20
SEND_TIMEOUT = 0.5
MESSAGES_PER_SECOND = 20
MESSAGE_BURST = 4
FRAME_TIMEOUT = 2


class StreamProcessor:
    def __init__(self):
        self.tracker = None

    def start_tracking(self):
        self.tracker = HandTracker()

    def process(self, frame: Frame):
        image = decode_jpeg(frame)
        if image is None:
            return None

        with image:
            if self.tracker is None:
                return {"type": "frame:ack"}

            return {"type": "tracking:result", "hands": self.tracker.detect(image)}

    def close(self):
        if self.tracker is not None:
            self.tracker.close()
            self.tracker = None


async def send_json(websocket: WebSocket, message: dict):
    await asyncio.wait_for(websocket.send_json(message), SEND_TIMEOUT)


async def close_socket(websocket: WebSocket, code: int):
    await asyncio.wait_for(websocket.close(code=code), SEND_TIMEOUT)


async def send_error(websocket: WebSocket, code: str, message: str, *, fatal: bool, **ids):
    await send_json(websocket, {"type": "stream:error", "code": code, "message": message, "fatal": fatal, **ids})
    if fatal:
        await close_socket(websocket, 1008)


@stream_router.websocket("/stream")
async def stream_endpoint(websocket: WebSocket):
    slots = websocket.app.state.stream_slots
    if slots.locked():
        await close_socket(websocket, 1008)
        return

    await slots.acquire()
    processor = StreamProcessor()
    pending = None
    version = 1
    stream_id = None
    last_frame_id = 0
    last_timestamp = -1.0
    tokens = MESSAGE_BURST
    updated_at = monotonic()

    async def run_worker(operation, timeout, *args):
        nonlocal pending
        pending = asyncio.create_task(asyncio.to_thread(operation, *args))
        # Closing the socket cannot interrupt native inference. Keep the slot until it exits.
        try:
            return await asyncio.wait_for(asyncio.shield(pending), timeout)
        finally:
            if pending.done():
                pending = None

    async def release_slot():
        try:
            if pending is not None:
                await asyncio.gather(pending, return_exceptions=True)
            await asyncio.to_thread(processor.close)
        finally:
            slots.release()

    try:
        await asyncio.wait_for(websocket.accept(), SEND_TIMEOUT)

        while True:
            packet = await asyncio.wait_for(websocket.receive(), IDLE_TIMEOUT if stream_id else START_TIMEOUT)
            if packet["type"] == "websocket.disconnect":
                return

            now = monotonic()
            tokens = min(MESSAGE_BURST, tokens + (now - updated_at) * MESSAGES_PER_SECOND)
            updated_at = now
            if tokens < 1:
                await send_error(websocket, "RATE_LIMITED", "Message rate exceeded.", fatal=True)
                return
            tokens -= 1

            text = packet.get("text")
            if text is not None:
                if len(text.encode("utf-8")) > MAX_TEXT_BYTES:
                    await close_socket(websocket, 1009)
                    return

                control = parse_object(text)
                request_id = control.get("requestId")
                if not is_id(request_id):
                    raise ProtocolError("Invalid request ID.")

                if (
                    stream_id is None
                    and set(control) == {"type", "requestId", "protocolVersion"}
                    and control["type"] == "stream:start"
                    and is_version(control["protocolVersion"])
                ):
                    version = int(control["protocolVersion"])
                    if version == 2:
                        try:
                            await run_worker(processor.start_tracking, START_TIMEOUT)
                        except Exception:
                            await send_error(
                                websocket, "TRACKER_UNAVAILABLE", "Hand tracker unavailable. Check the model setup.",
                                fatal=True, requestId=request_id,
                            )
                            return

                    stream_id = str(uuid4())
                    last_frame_id = 0
                    last_timestamp = -1.0
                    await send_json(websocket, {
                        "type": "stream:started", "requestId": request_id, "protocolVersion": version, "streamId": stream_id
                    })
                elif (
                    stream_id is not None
                    and set(control) == {"type", "requestId", "streamId"}
                    and control["type"] == "stream:stop"
                    and control["streamId"] == stream_id
                ):
                    await run_worker(processor.close, START_TIMEOUT)
                    stopped_id = stream_id
                    stream_id = None
                    await send_json(websocket, {
                        "type": "stream:stopped", "requestId": request_id, "streamId": stopped_id
                    })
                else:
                    await send_error(
                        websocket, "INVALID_CONTROL", "Unexpected stream control.", fatal=True, requestId=request_id
                    )
                    return
                continue

            if stream_id is None:
                raise ProtocolError("Frame received before stream start.")

            frame = read_frame(packet["bytes"], version)
            if (
                frame.stream_id != stream_id
                or (last_frame_id == 0 and frame.frame_id != 1)
                or frame.frame_id <= last_frame_id
                or frame.captured_at_ms <= last_timestamp
            ):
                raise ProtocolError("Frame does not match the current stream or is out of order.")

            last_frame_id = frame.frame_id
            last_timestamp = frame.captured_at_ms
            response_ids = {"streamId": stream_id, "frameId": frame.frame_id}

            try:
                result = await run_worker(processor.process, FRAME_TIMEOUT, frame)
            except TimeoutError:
                await send_error(websocket, "FRAME_TIMEOUT", "Frame processing timed out.", fatal=True, **response_ids)
                return
            except Exception:
                await send_error(websocket, "TRACKING_FAILED", "Frame processing failed.", fatal=True, **response_ids)
                return

            del frame, packet
            if result is not None:
                await send_json(websocket, {**result, **response_ids})
            else:
                await send_error(websocket, "INVALID_FRAME", "JPEG validation failed.", fatal=False, **response_ids)

    except ProtocolError:
        try:
            await send_error(websocket, "INVALID_MESSAGE", "Invalid streaming message.", fatal=True)
        except (WebSocketDisconnect, OSError, TimeoutError):
            pass
    except TimeoutError:
        try:
            await close_socket(websocket, 1008)
        except (WebSocketDisconnect, OSError, TimeoutError):
            pass
    except (WebSocketDisconnect, OSError):
        pass
    finally:
        await asyncio.shield(release_slot())
