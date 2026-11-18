from fastapi import WebSocket
from .router import api_router

@api_router.websocket("/stream")
async def stream_endpoint(websocket: WebSocket):
    await websocket.accept()
    while True:
        data = await websocket.receive_text()
        await websocket.send_text(f"Message text was: {data}")
