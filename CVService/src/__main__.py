import uvicorn

from .api.v1.protocol import MAX_PACKET_BYTES


if __name__ == "__main__":
    uvicorn.run(
        "src.main:create_app",
        factory=True,
        host="127.0.0.1",
        port=8000,
        ws="websockets",
        ws_max_size=MAX_PACKET_BYTES,
        ws_max_queue=1,
        ws_per_message_deflate=False,
        proxy_headers=False,
    )
