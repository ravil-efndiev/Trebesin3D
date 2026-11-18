from fastapi import APIRouter

from .websocket import stream_router

api_router = APIRouter(prefix="/api/v1", tags=["API v1"])
api_router.include_router(stream_router)
