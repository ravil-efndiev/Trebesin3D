import asyncio
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.health import health_router
from .api.v1.router import api_router
from .security import ApiKeyMiddleware, load_api_key


def create_app():
    origins = {
        origin.strip()
        for origin in os.environ.get(
            "CV_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",")
        if origin.strip()
    }
    if not origins or "*" in origins or "null" in origins:
        raise RuntimeError("CV_ALLOWED_ORIGINS must contain explicit trusted browser origins.")

    app = FastAPI(title="CV Service")
    app.state.stream_slots = asyncio.Semaphore(4)
    app.include_router(health_router)
    app.include_router(api_router)
    app.add_middleware(ApiKeyMiddleware, api_key=load_api_key(), origins=origins)

    return CORSMiddleware(
        app, allow_origins=sorted(origins), allow_methods=["GET"], allow_headers=["x-api-key"]
    )
