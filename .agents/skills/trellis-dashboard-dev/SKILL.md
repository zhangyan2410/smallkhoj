---
name: trellis-dashboard-dev
description: 开发和维护 Trellis Dashboard（./trellis-dashboard 本地只读仪表盘 + DSH agent 工作流）时使用。当用户要求给 dashboard 加功能/改界面/加工作流、调整 agent 运行行为，或在 DSH 对话里提到"dashboard"、"工作流"、"Agent tab"、"spec 审计"时加载。涵盖工具架构、修改惯例、验证命令和 Trellis 数据模型要点。
---

# Trellis Dashboard 开发指南

你是这个工具的开发者。用户会用自然语言提需求（"加一个 XX"、"把 XX 改成 YY"），你直接改代码完成。以下是架构与惯例。

## 仓库位置与启动

- 仓库根：`/Users/code/project/smallkhoj`（所有路径相对它）
- 启动：`./trellis-dashboard`（默认 127.0.0.1:4322，冲突自动 +1）；一次性快照 `./trellis-dashboard --json`
- **改 collector/server 等 Python 代码后必须重启服务进程才生效**（前端文件不用，刷新页面即可）
- 测试：`make trellis-dashboard-test`（node --check 前端 + unittest）

## 架构（Python stdlib 后端 + 无构建 vanilla JS 前端，零第三方依赖）

```
trellis-dashboard                       # 根 shim（照抄 smallkhoj-trace 模式）
tools/trellis-dashboard/
  dashboard.py                          # CLI 入口（--port/--json/--no-open/--demo/--root）
  server.py                             # ThreadingHTTPServer；GET 静态+API，POST /api/agent-runs
  collector.py                          # 快照采集（所有 _collect_* 函数，显式 root 参数便于测试）
  agent_runner.py                       # DSH 工作流运行器（单飞锁，spawn dsh --profile headless）
  agents/workflows/*.md                 # ★ 工作流注册表（frontmatter + 自包含 prompt）
  web/index.html|app.js|style.css|demo.js
  test_collector.py                     # unittest 夹具测试
```

核心数据流：`collector.collect_snapshot(root)` 生成全量 JSON（schema trellis.dashboard.v1）→ `GET /api/dashboard` → app.js 按 tab 渲染。新增数据源 = collector 加 `_collect_x(root)` + snapshot 加字段 + app.js 加渲染。

## 怎么改（按需求类型）

**加固定工作流**：往 `agents/workflows/` 写 `<id>.md`——frontmatter（id/name/description/timeoutMinutes）+ 正文是**自包含 prompt**（执行者不了解任何会话历史，方法/边界/输出格式全部写进文件）。不要改任何代码。已注册 id：spec-staleness-audit。

**加 tab**：index.html 加 `<button data-tab="x">`；app.js 加 `renderX(snapshot)` 函数并在 `renderView()` 路由；style.css 按需加样式。参考现有 renderAgents/renderSpecFiles 的写法（el() helper、CAPTURE_STATUS 徽章模式）。

**加数据源**：collector.py 加函数（读 `.trellis/` 下文件，容错 try/except 返回空结构）+ collect_snapshot 挂字段 + 前端渲染；test_collector.py 补夹具测试。

**改 agent 运行行为**：agent_runner.py（单飞锁在 run_state；DSH_BIN 可用 TRELLIS_DASHBOARD_DSH_BIN 覆盖以便测试）。

## 硬性惯例

- **只读原则**：除 `POST /api/agent-runs`（白名单工作流 + 409 单飞）外所有端点只读；不要加任意写端点。
- 安全模型：只绑 127.0.0.1；静态/工件路径 resolve 后前缀校验防穿越；工件预览 256KiB 截断；markdown 渲染先整体转义再套格式（renderMarkdown）；CSP `default-src 'self'`。
- 代码风格：Python 现代类型标注；前端 el() helper 构造 DOM（不拼 HTML 字符串，除了转义过的 markdown）。
- 提交信息格式 `feat(dashboard): ...` / `fix(dashboard): ...`；**不要自动 git commit**——改完报告，让用户审后提交（或用户明确说提交时再提交）。
- 验证：改后跑 `make trellis-dashboard-test`；涉及 UI 的改动用 `./twd goto http://127.0.0.1:4322/` + `./twd eval`/`./twd screenshot` 真机验证（不要为非 UI 改动跑浏览器）。

## Trellis 数据模型要点（dashboard 展示的数据从哪来）

- 活跃任务 `.trellis/tasks/MM-DD-slug/`（task.json + prd.md/design.md/implement.md/research/ + implement.jsonl/check.jsonl）；归档 `.trellis/tasks/archive/YYYY-MM/<dir>/`
- 任务解析复用 `.trellis/scripts/common/`（iter_active_tasks 等）——不要在前端/工具里重复实现
- AI 会话指针 `.trellis/.runtime/sessions/*.json`；journal `.trellis/workspace/<dev>/index.md` 的 `@@@auto:` 区块
- spec 契约库 `.trellis/spec/`（英文为准）+ 中文镜像 `.trellis/spec-zh/`（manifest.json 记源哈希判过期）
- 台账：`.trellis/spec/capture-ledger.json`（沉淀审计）、`.trellis/spec/spec-audit.json`（时效审计）
- agent 运行记录 `.trellis/.runtime/agent-runs/`（目录/runId/{meta.json,output.log} + agent-runs.jsonl 索引）

## DSH 集成现状

- 模型：GLM（Zhipu，OpenAI 兼容端点），provider 配置在 `~/.dsh/settings.yaml`
- 工作流：`dsh --profile headless <prompt>` 一次性执行（不能续聊）
- 对话：`dsh web`（127.0.0.1:3080，启动目录即默认 workspace 根）
- skill 目录：本文件所在 `.agents/skills/` 即 DSH 的 rank-200 发现层，新增 skill 直接放这里
