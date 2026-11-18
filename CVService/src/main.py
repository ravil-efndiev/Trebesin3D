from fastapi import FastAPI
from .api.health import health_router
from .api.v1.router import api_router

app = FastAPI(title="CV Service")

app.include_router(health_router)
app.include_router(api_router)
