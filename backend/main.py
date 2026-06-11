"""SmallKhoj 后端入口。参考 khoj main.py 的 FastAPI app 创建模式。"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from routers import health, chat, agent_api, public_api, hello
from models.seed import create_tables
from services.reminder_scheduler import start_reminder_scheduler, stop_reminder_scheduler
from services.thread_summary import start_thread_summary_scheduler, stop_thread_summary_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：创建或升级数据库表。"""
    await create_tables()
    reminder_task = start_reminder_scheduler()
    thread_summary_task = (
        start_thread_summary_scheduler()
        if settings.thread_summary_scheduler_enabled
        else None
    )
    try:
        yield
    finally:
        await stop_reminder_scheduler(reminder_task)
        await stop_thread_summary_scheduler(thread_summary_task)


app = FastAPI(
    title="SmallKhoj",
    version="0.2.0",
    lifespan=lifespan,
)

# CORS：开发时允许前端 localhost:3000 和 daemon proxy
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):[0-9]+$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(chat.router)
app.include_router(agent_api.router)
app.include_router(public_api.router)
app.include_router(hello.router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
