# Trellis Dashboard 快速启用（跨项目复用）

> 在新项目里快速把 Trellis Dashboard 立起来，并在同一处管理 Trellis 与 Comet 双工作流。

---

## 可移植性契约（这个工具是什么）

- 零第三方依赖：只用 Python 标准库（`ThreadingHTTPServer` + `urllib`），前端是无构建步骤的原生 JS。任何有 python3 的机器都能跑。
- dashboard 读取目标仓库 `.trellis/` 下**存在什么就展示什么**（任务、会话、journal、spec 库、沉淀台账、时效审计）以及 `docs/comet/`；每个数据源在输入缺失时优雅降级为空态。
- 安全模型随工具一起走：只绑 `127.0.0.1`、响应 `Cache-Control: no-store`、静态/工件路径防穿越校验、工件预览 256KiB 截断、CSP `default-src 'self'`（唯一例外是给内嵌 Comet Dashboard 的 `frame-src`）。

## 拷进新项目的文件

1. `tools/trellis-dashboard/` —— 整个目录（`dashboard.py`、`server.py`、`collector.py`、`agent_runner.py`、`agent_chat.py`、`agents/workflows/`、`web/`、`test_collector.py`）。
2. `./trellis-dashboard` —— 仓库根的启动 shim。
3. Makefile 目标 `trellis-dashboard-test`：对 `web/*.js` 跑 `node --check` + `python3 -m unittest discover -s tools/trellis-dashboard -p 'test_*.py'`。
4. 可选但推荐：`.agents/skills/trellis-dashboard-dev/SKILL.md`，让编码 agent 一落地就懂这套工具的惯例。

启动：`./trellis-dashboard`（默认 `127.0.0.1:4322`，被占用自动 +1）；一次性快照 `./trellis-dashboard --json`；用 `--root` 指向别的仓库。Python 侧改动要重启服务进程；前端文件刷新页面即可。

## 开箱可用 vs. 缺失降级

| 区域 | 依赖 | 缺失时 |
|------|-------|-----------|
| 任务/时间线/会话/journal tab | `.trellis/` 基础布局（tasks、`.runtime/sessions`、workspace journal） | tab 渲染为空 |
| Spec 沉淀 / Spec 文件 tab | `.trellis/spec/`（可选 `spec-zh/` 镜像、`capture-ledger.json`、`spec-audit.json`） | 降级为空 |
| Agent tab 工作流/对话 | PATH 上有 `dsh` 且 `~/.dsh/` 已配置（GLM 提供商） | 显示"未安装/不在 PATH"；对话输入禁用 |
| Comet tab | PATH 上有 `comet` | 显示"未安装/不在 PATH"；归档列表仍从 `docs/comet/archive/` 渲染 |

## Comet 集成契约（一个 dashboard，两个工作流）

用户的工作模型是 Trellis + Comet 同时使用；Comet tab 以只读方式管理 Comet 一侧：

- **数据**：活跃 change 来自 `comet status --json`（schema `comet.status.v2`，4 秒超时，出错落 error 字段）；默认工作流来自 `.comet/config.yaml`（正则解析——不引 yaml 依赖）；归档 change 从 `docs/comet/archive/<dir>/comet-state.yaml` 摘要（顶层 `name/phase/status/verification_result/created_at` 用 MULTILINE 正则；`^key:` 锚点天然忽略嵌套键）。
- **启动**：`POST /api/comet-web` —— 先探测 `127.0.0.1:4321` 端口（幂等）；未起则 spawn `comet dashboard --port 4321 --no-open`（`start_new_session=True`，随 dashboard 进程存续无关、独立存活），返回 `{url, started}`。
- **内嵌**：该 tab 用 iframe 嵌 `http://127.0.0.1:4321/`。CSP 是 `default-src 'self'; frame-src http://127.0.0.1:4321` —— 唯一的 frame-src 例外，不要放宽。
- **只读边界**：collector 只执行 `comet status --json`；dashboard 永远不跑 `comet native next/archive/new` 这类改状态的命令。

## 硬性惯例（工具迁移到哪里都不变）

- POST 白名单恰好是 `/api/agent-runs`、`/api/agent-chat`、`/api/dsh-web`、`/api/comet-web`；其余全部只读。新增 POST 端点是架构决策，不是顺手的事。
- `collector._collect_*(root)` 函数显式收 root 参数并容忍输入缺失；纯解析助手（如 `parse_comet_config`、`parse_comet_state_summary`）保持无副作用，便于夹具测试。
- 前端用 `el()` helper 构造 DOM（不拼 HTML 字符串）；tab 在 `index.html` 注册 + `renderView()` 路由。
