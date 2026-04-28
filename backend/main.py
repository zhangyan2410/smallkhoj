"""SmallKhoj 后端入口。参考 khoj main.py 的 FastAPI app 创建模式。"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from routers import health, chat


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动/关闭时的操作。后续可在此加入 APScheduler、DB 初始化等。"""
    yield


app = FastAPI(
    title="SmallKhoj",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS：开发时允许前端 localhost:3000
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(chat.router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
