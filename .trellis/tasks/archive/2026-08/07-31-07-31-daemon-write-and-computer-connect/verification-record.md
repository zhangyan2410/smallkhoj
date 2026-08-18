# 本地真实验证记录（2026-07-31 接手后续）

> 由接手 agent 完成。所有凭据脱敏；不读取/保存 connect ticket、machine token、认证 cookie 或完整 apiKey。

## 结论

**本地完整闭环已验证通过**：产品动态 `start_runtime` control 包现在携带 `config.allowWrites: true`，daemon 据此为托管 Runtime 注入 `SLOCK_ALLOW_WRITES=1` 与带 gate 的 `.slock` wrapper，Runtime 通过 wrapper 的 `slock message send` 成功回信，并在可见 UI 频道中署名显示。daemon 独立 CLI 的 fail-closed 语义未放宽。

## 验证环境

- Feature worktree: `/Users/code/project/smallkhoj-daemon-write-and-computer-connect`（branch `feat/daemon-write-and-computer-connect`，未 commit）
- 隔离测试服务：backend `:8100`、frontend `:3100`（根服务 `:8000/:3000` 未动）
- 测试 DB：`localhost:55432/smallkhoj`（feature 独立数据库）
- daemon：UI 签发的 `npx @smallkhoj/smallkhoj-daemon@0.2.1 aura --server-url http://localhost:8100 --api-key <one-time ticket>`，经本地 relay 交给隔离 shell 执行
- fake runtime：`/tmp/smallkhoj-local-connect.ac4-20260731-1723/fake-claude.mjs`（不调用任何模型，经 daemon 生成的 wrapper 操作 slock CLI）

## 执行的验证步骤

1. **tarball HTTP probe**：`http://127.0.0.1:8100/downloads/smallkhoj-daemon/smallkhoj-smallkhoj-daemon-0.2.1.tgz` → `200 / 231707 bytes`（本地 artifact 前置条件修复验证）。
2. **UI 重新签发 connect ticket**：`http://localhost:3100/computers` 点击"重连"→ 新 reconnect command 生成；经本地 relay（`127.0.0.1:47832`）从浏览器 DOM 直接交给隔离 shell，ticket 不经过模型/终端。
3. **daemon 上线**：`/daemon/connect` → WebSocket 连接 → `Computer LOCAL_DAEMON_AC4_20260731_1723` 变为 `online`，lease 有效（DB 验证 + UI "1 在线"）。
4. **创建 #general 频道**：`POST /api/v1/channels`（浏览器上下文 session+active-server）→ `#general` 创建成功。
5. **成员页 UI 创建 Agent**：`/members` 页面 Create-agent 对话框（真实 UI 路径），创建 `LOCAL_UI_AGENT_180703`（claude_code，绑定测试 Computer）。后端按产品默认 autoStart 立即下发 `start_runtime`。
6. **动态 start_runtime 验证**：
   - daemon 日志：`claude_code runtime started for agent f14450ec...`（UI 创建的 Agent）
   - fake runtime marker：`allowWrites="1"`、`serverInfoOk=true`、`sendOk=true`、`writesBlocked=false`
   - 首条 marker 消息 `LOCAL_ALLOW_WRITES_AC5_20260731_1736` 落入 `#general`，署名 `f14450ec`（Agent）。
7. **频道成员加入**：`POST /api/v1/channels/{id}/members` 将测试 Agent 加入 `#general`（DB 确认 2 名成员：人类 creator + Agent）。
8. **双向 UI 交互**（最终验证）：
   - UI `#general` 发送 `@LOCAL_UI_AGENT_180703 LOCAL_PING_AC5_FINAL8526`
   - daemon 经 WS 投递至 runtime stdin；runtime 先 `slock message check` 消费 pending 队列（proxy `held/pending_messages` 保护语义），再经带 gate 的 wrapper 发送
   - Agent 回信 `LOCAL_ACK_AC5_20260731_1736 pong:LOCAL_PING_AC5_FINAL8526` 0.6s 后落库并在 UI 可见，署名 `LOCAL_UI_AGENT_180703 | 智能体`。
   - 交互期间 `sendOk=true`、`writesBlocked=false`、`sendStderr=""`。

## 证据文件

`.trellis/tasks/07-31-07-31-daemon-write-and-computer-connect/evidence/`：

- `REAL_AC5_summary.json` — 脱敏验证摘要（computer/agent/channel/交互/marker）
- `REAL_AC5_general_channel_final.snapshot.txt` — #general 频道可见 UI snapshot（含 ping 与 pong 行）
- `REAL_AC5_general_channel.png` — 消息区域截图
- `REAL_AC5_daemon_trace.txt` — daemon 日志关键行 + fake runtime marker + 交互 log
- `REAL_AC5_general_channel.snapshot.txt` — 早期 snapshot（保留）

## DB 计数（脱敏，feature DB）

| 指标 | 值 |
|---|---|
| 测试 Computer（LOCAL_DAEMON_AC4_20260731_1723） | 1，status=online |
| 本地测试 Agent（LOCAL_%AGENT%） | 1 |
| 测试 Computer 上 running workspace | 1 |
| `LOCAL_%` marker 消息总数 | 4 |
| #general 频道成员 | 2 |

## 保留状态（明确记录）

- **保留中**（供用户继续查看/使用）：测试 Computer `LOCAL_DAEMON_AC4_20260731_1723`、Agent `LOCAL_UI_AGENT_180703`、workspace、`#general` 频道及其 4 条 marker 消息、relay（pid 44019）、daemon（npx 进程）+ fake runtime（pid 48007）。
- **已清理**：误启动的 @ccc runtime（已 stop，workspace 保持 stopped）；API 直建的临时 agent `LOCAL_AGENT_AC5_132997`（已删除）。
- 未删除任何非测试对象。

## 遗留

- 本地闭环验证完成；云端验证需在 commit/PR/合并/release pipeline gate drift 修正后进行（见 implement.md 云端部分）。
- fake runtime 与 relay 位于 `/tmp/smallkhoj-local-connect.ac4-20260731-1723/`（测试隔离，非仓库内容）。
