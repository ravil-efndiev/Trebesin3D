import asyncio
from time import monotonic
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .protocol import MAX_TEXT_BYTES, ProtocolError, is_id, is_version, parse_object, read_frame, decode_jpeg


stream_router = APIRouter()
START_TIMEOUT = 3
IDLE_TIMEOUT = 20
FRAME_TIMEOUT = 2
SEND_TIMEOUT = 0.5
MESSAGES_PER_SECOND = 20
MESSAGE_BURST = 4


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
    pending_decode = None
    stream_id = None
    last_frame_id = 0
    last_timestamp = -1.0
    tokens = MESSAGE_BURST
    updated_at = monotonic()

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
                    stream_id = str(uuid4())
                    last_frame_id = 0
                    last_timestamp = -1.0
                    await send_json(websocket, {
                        "type": "stream:started", "requestId": request_id, "protocolVersion": 1, "streamId": stream_id
                    })
                elif (
                    stream_id is not None
                    and set(control) == {"type", "requestId", "streamId"}
                    and control["type"] == "stream:stop"
                    and control["streamId"] == stream_id
                ):
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

            frame = read_frame(packet["bytes"])
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

            pending_decode = asyncio.get_running_loop().run_in_executor(None, decode_jpeg, frame)
            try:
                image = await asyncio.wait_for(asyncio.shield(pending_decode), FRAME_TIMEOUT)
            except TimeoutError:
                await send_error(websocket, "FRAME_TIMEOUT", "Frame processing timed out.", fatal=True, **response_ids)
                return

            pending_decode = None
            del frame, packet
            if image is not None:
                image.close()
                await send_json(websocket, {"type": "frame:ack", **response_ids})
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
        if pending_decode is None:
            slots.release()
        else:
            # A timeout or disconnect cannot interrupt a native decode.
            def release_after_decode(worker):
                try:
                    if worker.cancelled() or worker.exception() is not None:
                        return
                    image = worker.result()
                    if image is not None:
                        image.close()
                finally:
                    slots.release()

            pending_decode.add_done_callback(release_after_decode)
