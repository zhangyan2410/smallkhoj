# Windows Computer 三阶段安装与连接：交接说明

**交接日期：** 2026-08-06  
**当前分支：** `main`  
**当前结论：** `IN_PROGRESS`。Mac 侧的主体实现和自动化回归已完成；Windows x64 实机验收仍未完成，因此本任务不能标记为完成。Mac 的真实浏览器/运行时证据也需要在同一候选测试栈上补齐。

## 已落地的主体实现

- 后端在 `backend/routers/public_api.py` 增加了 ticket-free 的 `connect-preview` / `reconnect-preview`，并返回结构化的 Windows PowerShell 与 macOS/Linux shell 命令；旧 Unix `command` 字段继续保留。
- Connect/Reconnect 才会创建 `sk_connect_` ticket，并返回 `expiresAt`；预览响应固定返回 `ticket: null`、`expiresAt: null`。
- `scripts/build_daemon_distribution.py` 支持 `win32-x64` / `win32-arm64` / `win32-x86` ZIP、`install.ps1`、版本目录、SHA-256、用户 PATH 和 active pointer。Mac 不伪造 PE `.exe`：Windows 构建必须由 Windows 侧提供真实 `node.exe` 与 `aura.exe`。
- daemon 新增平台路径与本地 Setup：Windows 默认使用 `%LOCALAPPDATA%\\Aura\\daemon`，machine ID 首次生成、重复 Setup 复用、显式 `--reset` 重新生成；`status --json` 报告实现类型、平台、架构和路径。
- Computers UI 改为互斥的 Windows / macOS/Linux tabs，并展示 Install → Setup → Connect 三阶段；Connect/Reconnect 才有显式 ticket action；重连路径只展示 Connect。
- 新增可访问的共享 `Tabs` atom、双语文案、阶段/复制/过期/Online/失败状态和回归 test IDs；旧 `daemon-connect-command` 兼容标记已保留在 Connect 命令 proof surface 上。
- 前端规范已把旧的“一条可复制命令”契约改成平台互斥三阶段契约。

## Mac 侧已验证

以下验证在当前 checkout 执行并通过；完整命令与结果摘要见 [macos-evidence.md](./macos-evidence.md)。

| 层 | 结果 |
|---|---|
| daemon TypeScript build | PASS |
| daemon build + 本任务平台路径测试 | PASS（平台路径 3/3） |
| daemon 全量 runtime suite | BLOCKED：本机 backend `:8000` 不可达，runtime 用例出现 HTTP 502/等待超时；不是 Windows 验收证据 |
| backend command/preview + server-context tests | PASS（12/12 + 26/26，含 preview 不写 DB 的测试） |
| distribution builder tests | PASS（8/8，含 PE 头拒绝） |
| frontend targeted tests / typecheck / targeted ESLint | PASS（42/42 targeted tests） |
| frontend production build | PASS（使用本地临时构建变量；仅有 Better Auth base URL warning） |
| `git diff --check` | PASS |

路径测试曾在 Mac 上用 `platform: "win32"` + POSIX 临时目录生成过 4 个反斜杠文件；`paths.ts` 已修复，异常文件已删除，并新增断言防止再次污染 checkout。

## 尚未完成、必须由 Windows 侧继续

请按 [windows-acceptance.md](./windows-acceptance.md) 在真实 Windows x64 主机执行并把脱敏证据放入 `evidence/`：

1. 用原生 API/PowerShell 记录 CPU 架构、PowerShell 版本、PATH，以及是否预装 Node/npm/npx。
2. 在无 Node/npm/npx 的干净用户环境执行 `install.ps1`，验证 `%LOCALAPPDATA%\\Aura`、版本目录、`node.exe`、`aura.exe`、sidecar、manifest/checksum、PATH 和 `aura --version`。
3. 执行 Setup，验证名称、machine ID、配置/credential ACL、重启后幂等复用，以及显式 reset 只在需要时换 ID。
4. 用新 ticket 执行首次 Connect，确认服务器 Computer Online/heartbeat；停止后用 Reconnect 验证最新兼容版本和原 machine ID/配置复用。
5. 验证旧 daemon/Node daemon 与 active lease 冲突、stale lease 的 graceful stop（不得 force kill）、升级、禁止隐式降级、下载失败恢复和显式 rollback。
6. 发布真实 Windows manifest 后，确认 Web Windows tab 从 unavailable warning 恢复为三阶段命令；未发布 manifest 时必须保持 fail-closed，不复制残缺命令。

Windows 侧在证据完成前不要把 `task.json.status` 改成 `completed`，也不要声称“Windows acceptance 通过”。

## 当前已知边界

- 当前 Mac checkout 没有 Windows release manifest，后端会把 Windows 平台标为 unavailable；这是有意的 fail-closed 行为，不是伪造安装命令的理由。
- Mac 环境当前 `127.0.0.1:3000`、`127.0.0.1:8000` 均未健康运行；虽然 WebDriver bridge 能看到其他标签页，不能证明那些页面来自本 checkout。故本次没有把 stale tab 截图当作真实 UI PASS。
- 本地自动化没有替代 Windows 实机门槛；任何 `.exe`、PATH、ACL、升级/回滚和进程/lease 结论都必须来自 Windows 主机输出。
- Connect 命令含一次性敏感 ticket。证据只保留脱敏命令（例如把 token 替换为 `<REDACTED_CONNECT_TICKET>`），不要把原始 token 写进截图、URL、日志或提交。

## 建议的 Windows 交接顺序

```text
fetch main → 在 Windows 生成真实 node.exe/aura.exe → 构建并发布 ZIP + manifest
    → install.ps1 → setup（幂等）→ Connect（fresh ticket）→ Online/heartbeat
    → stop → Reconnect（复用 machine ID）→ 冲突/升级/回滚 → 填 evidence
```

完成 Windows 证据和 Mac 同候选真实 UI/runtime 证据后，再由负责人复核 PRD R13 和 Acceptance Criteria，最后更新任务状态。
