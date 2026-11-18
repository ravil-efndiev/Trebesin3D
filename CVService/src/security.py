import os
import secrets
from uuid import UUID

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send


def load_api_key() -> bytes:
    value = os.environ.get("CV_SERVICE_API_KEY", "")

    try:
        key = UUID(value)
    except ValueError:
        raise RuntimeError("Set CV_SERVICE_API_KEY to a UUIDv4 before starting CVService.") from None

    if key.version != 4 or str(key) != value:
        raise RuntimeError("CV_SERVICE_API_KEY must be a canonical lowercase UUIDv4.")

    return value.encode("ascii")


class ApiKeyMiddleware:
    def __init__(self, app: ASGIApp, api_key: bytes, origins: set[str]):
        self.app = app
        self.api_key = api_key
        self.origins = {origin.encode("ascii") for origin in origins}

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        path = scope.get("path", "")
        is_api = path == "/api" or path.startswith("/api/")
        is_socket = scope["type"] == "websocket"

        if not is_api or scope["type"] not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return

        keys = [value for name, value in scope["headers"] if name.lower() == b"x-api-key"]
        authorized = len(keys) == 1 and secrets.compare_digest(keys[0], self.api_key)

        if is_socket:
            origins = [value for name, value in scope["headers"] if name.lower() == b"origin"]
            if not authorized or len(origins) != 1 or origins[0] not in self.origins:
                if (await receive())["type"] == "websocket.connect":
                    await send({"type": "websocket.close", "code": 1008})
                return
        elif not authorized:
            await JSONResponse({"detail": "Unauthorized"}, status_code=401)(scope, receive, send)
            return

        await self.app(scope, receive, send)
