# Trellis Dashboard

Trellis 本地只读任务仪表盘（参考 Comet Dashboard 的形态）。零第三方依赖：
Python 3 标准库后端 + 无构建的 vanilla JS 前端。

## 使用

```bash
./trellis-dashboard                 # 启动，默认 http://127.0.0.1:4322（占用时自动 +1）
./trellis-dashboard --json          # 采集一次快照输出 JSON 后退出（脚本化）
./trellis-dashboard --port 4400     # 指定起始端口；--port 0 随机
./trellis-dashboard --no-open       # 不自动打开浏览器
./trellis-dashboard --demo          # 打开的 URL 附带 ?demo（内置演示数据）
./trellis-dashboard --root <path>   # 指向其他仓库根目录读取其 .trellis 数据
```

浏览器中加 `?demo` 也可直接切到演示数据。

## 展示内容

- **概览卡片 + 风险条**：活跃/归档任务、Git 脏文件（可点击展开清单）、AI 会话数、
  spec 层；P0 数量、MISSING_PRD、失效会话指针、journal 接近 2000 行上限等风险提示。
- **任务浏览器**：按状态筛选（规划/进行中/已完成未归档/已归档）+ 搜索；卡片带状态
  徽章、优先级、风险计数、子任务进度。
- **任务详情**：Plan → Execute/Finish → Completed 阶段步进条、下一步建议（映射
  workflow.md 的流程）、Phase 1 完成度检查（prd/design/implement/jsonl 策展）、
  元数据（分支/worktree/提交）、父子任务关系、工件列表。
- **工件预览**：点击工件在抽屉中预览 Markdown / JSON / JSONL（转义优先渲染，
  256 KiB 截断）。
- **会话面板**：`.trellis/.runtime/sessions/` 的 AI 窗口指针（平台、最后活跃、
  当前任务、任务状态、失效标记）。
- **时间线**：workspace journal 的 session 历史、journal 文件行数、最近 git 提交。

## 数据来源与复用

- 任务解析复用本仓库 `.trellis/scripts/common`（`iter_active_tasks`、`load_task`、
  `get_all_statuses`、`get_task_stats`、`get_context_packages_json`、`run_git`），
  与 Trellis 模板保持单一事实来源。
- 其余数据按磁盘约定直接读取：`.trellis/tasks/`（含 `archive/YYYY-MM/`）、
  `.trellis/.runtime/sessions/`、`.trellis/workspace/<dev>/index.md` 的
  `@@@auto:` 区块、`.trellis/.developer`。
- 任务状态兼容历史值：`done` 视同 `completed`。

## 安全模型（对齐 Comet Dashboard）

- 只绑定 `127.0.0.1`，不对外暴露；所有响应 `Cache-Control: no-store`。
- 静态文件 resolve 后必须仍位于 `web/` 内（防路径穿越）。
- 工件预览限定在任务目录内，拒绝 `..`/绝对路径/反斜杠，读取上限 256 KiB。
- Markdown 渲染先整体 HTML 转义再套格式，链接仅允许 http(s)/相对/锚点。
- 响应带 `Content-Security-Policy: default-src 'self'` 与 `X-Content-Type-Options: nosniff`。
- 完全只读：没有任何推进/归档/写操作。

## 文件结构

```
trellis-dashboard            # 根目录 shim（照抄 smallkhoj-trace 模式）
tools/trellis-dashboard/
  dashboard.py               # CLI 入口
  server.py                  # stdlib HTTP 服务 + API 路由
  collector.py               # 快照采集（数据层）
  web/index.html|app.js|style.css|demo.js
  test_collector.py          # unittest 夹具测试
```

## 测试

```bash
make trellis-dashboard-test   # node --check 前端 + unittest collector 测试
```

## 范围外（v1 不做）

mermaid 图表、多项目注册表、任何写操作、`.trellis/config.yaml` 展示、spec/guides
层明细、journal 正文渲染（仅索引表）。
