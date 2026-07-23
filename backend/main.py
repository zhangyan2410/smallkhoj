"""SmallKhoj 后端入口。参考 khoj main.py 的 FastAPI app 创建模式。"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import settings
from routers import health, chat, agent_api, public_api, hello
from models.seed import create_tables
from models import async_session
from services.public_events import (
    initialize_public_event_cursors,
    start_postgres_public_event_listener,
    stop_postgres_public_event_listener,
)
from services.reminder_scheduler import start_reminder_scheduler, stop_reminder_scheduler
from services.thread_summary import start_thread_summary_scheduler, stop_thread_summary_scheduler
from services.cors_config import build_cors_origins
from services.schema_readiness import assert_schema_at_head

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DAEMON_DOWNLOAD_DIR = PROJECT_ROOT / "release-artifacts" / "smallkhoj-daemon"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：迁移完成后执行幂等数据种子并启动后台服务。"""
    async with async_session() as db:
        await assert_schema_at_head(db)
    await create_tables()
    async with async_session() as db:
        await initialize_public_event_cursors(db)
    await start_postgres_public_event_listener()
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
        await stop_postgres_public_event_listener()


app = FastAPI(
    title="SmallKhoj",
    version="0.2.0",
    lifespan=lifespan,
)

# CORS：开发默认允许 localhost，并可追加显式生产域名。
app.add_middleware(
    CORSMiddleware,
    allow_origins=build_cors_origins(settings.backend_cors_origins),
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

app.mount(
    "/downloads/smallkhoj-daemon",
    StaticFiles(directory=str(DAEMON_DOWNLOAD_DIR), check_dir=False),
    name="smallkhoj-daemon-downloads",
)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
