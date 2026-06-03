"""Hello API 路由。"""
from fastapi import APIRouter

router = APIRouter(tags=["hello"])


@router.get("/api/hello")
async def hello():
    return {"message": "hello from worker"}
