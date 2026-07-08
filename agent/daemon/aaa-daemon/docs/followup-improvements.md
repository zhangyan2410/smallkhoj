# 待改进项记录

## 1. Codex ACP Runtime 环境注入缺失

**问题**：Codex ACP runtime 的 tool shell 没有继承 daemon 注入的 PATH 和 env（`SLOCK_AGENT_PROXY_URL`、`SLOCK_AGENT_PROXY_TOKEN_FILE`、`SLOCK_AGENT_ID`），导致 Codex agent 只能用 wrapper 绝对路径（`/Users/lee/.slock/cli-transport/<agent-id>/pid-<pid>/raft`）调用 CLI，而不是短命令 `raft message check`。

**影响**：
- activity feed 中出现超长路径，浪费 token
- 可读性差，用户困惑
- 与其他 runtime（Claude/Kimi/GLM）不一致，它们能直接用短命令

**修复方向**：在 aaa-daemon 的 Codex ACP runtime driver（`src/runtime/`）中，启动 Codex 进程时：
1. 将 `cli-transport/<agent-id>/pid-<pid>/` 目录 prepend 到 `PATH`
2. 或直接 export `SLOCK_AGENT_PROXY_TOKEN_FILE` / `SLOCK_AGENT_PROXY_URL` / `SLOCK_AGENT_ID` 到 tool shell env

**优先级**：中（不阻塞 CLI 产品化，但影响日常协作体验和 token 效率）

**发现时间**：2026-07-08，CLI 产品化迁移完成后 review 时发现
