# 目录结构

> 本项目后端代码如何组织。

---

## 概览

`backend/` 是单个 FastAPI 应用（`main.py:50-54` 的模块级 `app`，不是 app 工厂）。代码分层为 **routers → services → models**，Alembic 是唯一的 schema 写入者，并由只读启动守卫强制执行。以下事实是当前布局，不是愿景。

---

## 目录布局

```
backend/
├── main.py                    # FastAPI app 入口：lifespan、CORS、路由注册
├── config.py                  # pydantic-settings 的 Settings（config.py:62-201）
├── alembic/                   # 迁移环境
│   ├── env.py                 # 导入 models.slock 注册到 Base.metadata（env.py:15）
│   └── versions/              # 6 个 revision，单链：0001_baseline → 0006_stable_member_identity
├── models/                    # SQLAlchemy ORM 层
│   ├── base.py                # engine、async_session、Base、get_db 依赖（base.py:7-26）
│   ├── slock.py               # 全部 32 张 ORM 表（单文件，schema 事实源）
│   ├── seed.py                # 只做运行时数据种子——"Never add table/index DDL here"
│   └── __init__.py            # re-export 全部 ORM 类
├── routers/                   # FastAPI HTTP/WS 端点（8 个模块）
│   ├── agent_api.py           # agent 侧 API + /ws daemon WebSocket（含租约 add_exclusive）
│   ├── public_api.py          # 公开 API（5960 行）
│   ├── auth.py                # Bearer + X-Agent-Id 鉴权依赖
│   └── chat.py / health.py / hello.py / member_serialization.py / serialization_prefetch.py
├── schemas/                   # Pydantic 响应 schema（目前只有 health.py 的 HealthResponse；
│                              #   多数响应模型仍内联在 router 里）
├── services/                  # 业务逻辑与后台服务（40 个模块）
├── scripts/                   # legacy_schema_preflight.py（只读兼容性预检）
├── tests/                     # 平铺 pytest 套件：56 个 test_*.py + postgres_test_support.py
├── feishu_worker_cli.py       # 独立的飞书长连接 worker 进程入口
├── integration_bootstrap_cli.py / live_run_preflight_cli.py   # CLI 工具（JSON 输出到 stdout）
├── alembic.ini / pyproject.toml / uv.lock / Dockerfile        # uv 管理依赖
└── .data/uploads              # 本地上传 blob 存储（运行时产物）
```

---

## 模块组织

### 分层

| 层 | 职责 | 可 import |
|-------|----------------|------------|
| `routers/` | HTTP/WS 端点、鉴权接线、请求/响应形状 | `services/*`、`models`、`schemas` |
| `services/` | 业务逻辑、后台循环、事件扇出 | `models`（绝不 import `routers`） |
| `models/` | ORM 表、engine/session、数据种子 | 仅 sqlalchemy |
| `alembic/` | schema 迁移——唯一的 schema 写入者 | `models.slock` 的 metadata |

诚实的例外：router 也会直接 import `models` 并跑 `select()`（public_api.py:20-26、agent_api.py:31-36）；service 层是放共享/可复用逻辑的地方，不是强制中转站。

### 启动顺序（main.py 的 lifespan，main.py:27-47）

`assert_schema_at_head(db)` → `create_tables()`（幂等数据种子，seed.py:25-31）→ 事件游标初始化 → Postgres listener、reminder scheduler、thread summary scheduler；关闭时逐个 stop。

### schema 权威链

- Alembic revision 是 schema 的唯一事实源；`models/seed.py` 只种数据（docstring，seed.py:1-14）。
- 数据库 revision 不等于唯一 head 时，应用拒绝启动（services/schema_readiness.py:18-52，只读守卫）。
- 守护测试强制这一点：tests/test_schema_authority.py 断言种子源码不含 `create_all`/DDL，且两个 compose 文件都执行 `uv run alembic upgrade head && uv run uvicorn`（docker-compose.yml:17、docker-compose.prod.yml:18）。
- 部署顺序是先迁移后服务，绝不是先服务后建表（docs/migration-workflow.md）。

---

## 新代码放哪

| 要加的东西 | 放在… |
|-----------|-----------|
| HTTP/WS 端点 | `routers/`（在 main.py:66-70 注册） |
| 共享业务逻辑 / 后台循环 | `services/`（新模块） |
| ORM 表或列 | `models/slock.py` + `alembic/versions/` 新增一个 Alembic revision（绝不走启动 DDL） |
| 响应 schema | `schemas/`（注意：现有响应模型大多内联在 router 里；`schemas/` 目前只有 health） |
| 破坏性迁移 / 真 Postgres 测试 | `tests/` 用 `*_postgres*.py` 后缀，配合 `postgres_test_support.py`（每测试一次性数据库） |
| 独立进程入口 | backend 根目录（范式：`feishu_worker_cli.py`） |

---

## 命名惯例

- 测试：平铺 `test_*.py`；Postgres 集成测试带 `*_postgres.py` / `*_postgres_http.py` 后缀。
- services/routers：单数领域名词（`task_runs.py`、`daemon_control.py`）。
- 模块 logger：`logger = logging.getLogger(__name__)`（见 logging-guidelines.md）。
- 依赖由 uv 管理（pyproject.toml + uv.lock）；ruff line-length 120。

---

## 示例

- 端点 → service → model 链：routers/public_api.py:156（`create_task_assignment_and_run`）→ services/task_runs.py:10（import `models`）→ models/slock.py 的表。
- 事件扇出 service：services/public_events.py（LISTEN/NOTIFY、自带生命周期日志）。
- 租约强制端点：routers/agent_api.py:2067-2075（`add_exclusive` + `lease.revoked` 关闭 4001）。
