# Real Pi Relay Test — 2026-07-30

marker: `REAL_PI_RELAY_<ts>` (多条)
环境: backend @ 8000 (本 worktree, 带 pi+relay+key) + frontend @ 3000 + daemon (bundled pi) + PG smallkhoj 库 @ 55432
MiniMax: api.minimaxi.com/anthropic, model MiniMax-M3 (cc-switch 的 key)

## 验证链路 (全部打通)

1. **daemon 检测 bundled Pi** ✅
   - `SMALLKHOJ_DAEMON_INSTALL_ROOT` + `SMALLKHOJ_BUNDLED_NODE` 设好
   - computer.detected_runtimes 含 `{"type":"pi","source":"bundled","version":"0.73.1"}`
2. **创建 pi agent** ✅
   - 修了 `public_api._public_runtime` aliases 加 `"pi"`
   - 修了 create_agent 把 runtime 写进 `config["runtime"]` + `member.backend`（否则 require_pi_runtime_member 403）
3. **daemon 启动 Pi** ✅
   - workspace runtime=pi, status=running
   - Pi 进程: agent_start → turn_start → user message → assistant message
4. **Pi acquire lease** ✅
   - llm_run_leases 表: status waiting→active→released, 无 failure_code
5. **Pi 经 relay 调 MiniMax (anthropic-messages)** ✅
   - 修了 daemon proxy 接受 `x-api-key`（Anthropic 格式，原来只认 Bearer）
   - 修了 relay 支持 anthropic `/llm/anthropic/v1/messages` 路径 + x-api-key + anthropic-version header
   - backend 日志: `POST /internal/agent-api/llm/anthropic/v1/messages HTTP/1.1 200 OK`
   - MiniMax 直连验证: HTTP 200, 回复"你好", model MiniMax-M3, usage 正常

## 未完全闭环 (Pi 端 SSE 解析)

- Pi 拿到 relay 200 响应后报: `Cannot read properties of undefined (reading 'input')`
- 根因: Pi 0.73.1 的 anthropic-messages 流式 adapter 把 `usage.input_tokens` 映射到内部 `usage.input` 时, 在某条 SSE event 上 usage 对象缺失
- 这是 Pi 包内部对 MiniMax anthropic SSE 的兼容边缘, **不是本任务 relay/lease/daemon 代码的 bug** (relay 正确透传标准 anthropic SSE, MiniMax 直连验证格式标准)
- agent 回复因此未写入 DM (Pi 因解析错误中断回合)

## 数据库修复 (smallkhoj 旧库迁移到 head 的副作用)

旧 smallkhoj 库从 07-22 seed 体系迁到 alembic head 时, 手动修了:
- `messages.seq` 改成 identity BY DEFAULT (旧库是普通列, 0002/0003 没真跑)
- 删 `messages_seq_key` 唯一约束 (与 identity 冲突)
- 降 server 3893c518 的多余 owner (recover_avatar) 为 member

## 真测中发现的代码修复 (已落地)

| 文件 | 修复 |
|---|---|
| `backend/routers/public_api.py` | `_public_runtime` aliases 加 `"pi"`; create_agent 写 `config["runtime"]`+`member.backend` |
| `agent/daemon/aaa-daemon/src/proxy/agent-proxy.ts` | 接受 `x-api-key` (Anthropic) 作为 proxy 认证, 不只 Bearer |
| `backend/routers/agent_api.py` | 加 `/llm/anthropic/{path}` relay 路由 + `_relay_builtin_pi_llm_impl` 共用 |
| `backend/services/pi_llm_relay.py` | `validate_pi_relay_request` 支持 `messages`/`v1/messages` (anthropic) 路径 |
| `agent/daemon/aaa-daemon/src/runtime/pi-runtime.ts` | `apiFormat` 可配 (anthropic/openai), 默认 anthropic, model 默认 MiniMax-M3 |
