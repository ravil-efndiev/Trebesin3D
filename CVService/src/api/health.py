from fastapi import APIRouter

health_router = APIRouter(prefix="/api/health", tags=["Health"])

@health_router.get("/")
def health_check():
    return { "status": "ok" }
