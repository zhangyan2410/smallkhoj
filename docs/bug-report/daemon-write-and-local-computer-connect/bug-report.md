# Daemon 写门禁与本地 Computer 连接诊断

## Bug 诊断胶囊

| 栏位 | 内容 |
| --- | --- |
| **1. 现象** | Server 启动的 Agent Runtime 调用 `slock message send` 返回 `WRITES_NOT_ALLOWED`；本地 Computers UI 生成的 daemon 命令无法注册 Computer。期望是：产品管理 Runtime 默认可以发送消息，且本地 UI 命令能在本地控制面注册隔离 Computer。 |
| **2. 证据** | `c33a0a38` 将 daemon Runtime 写操作改为显式 opt-in；后端 `runtime_start_command()` 未迁移 `allowWrites`。真实 local-dev UI 命令请求的 `0.2.1` tgz 返回 HTTP 404，而云端同一版本 tgz 返回 HTTP 200。local 与 cloud 数据库不共享 Computer/Workspace。 |
| **3. 确认根因** | 产品 control plane 漏传 daemon 已支持的 `config.allowWrites: true`；同时本地 ignored `release-artifacts` 只有旧版 `0.2.0` package，但 backend 宣告 `0.2.1`，使 npm 在 daemon connect 前失败。daemon 的 fail-closed gate 不是故障。 |
| **4. 诊断策略** | 先以 backend unit test 锁定控制包字段；再以 dynamic daemon control test 验证 field → child env/wrapper → scoped send；使用真实 UI 命令、版本化 artifact HTTP probe、隔离 machine id/daemon 来验证 local；最后在云端专用测试 Computer 验证部署结果。 |
| **5. 超时策略** | 若 local connect 在 artifact 可下载后仍失败，保存已脱敏的 HTTP status、daemon register/WS timeline，回到 connect ticket/lease 入口；若 cloud control/reply 超时，不重试模型 prompt，先读 control/daemon trace 并报告。 |
| **6. 预警策略** | 不允许使用 cloud Computer/ticket 测 local；不允许以 `--allow-writes` 放宽所有 CLI；任何“local 成功即 cloud 成功”的结论无效。三次无效修复即停止并重新审视控制面架构。 |
| **7. 用户可见交互修正** | 用户在 Server 创建的 Runtime 可以正常通过 Slock 发送回复；本地 Computers UI 的单条 onboarding 命令在对应 package 已准备时能连接并显示 online/lease。 |
| **8. 验收** | backend config regression、daemon dynamic control regression、默认 CLI fail-closed coverage、local UI→package→connect→lease→Runtime evidence，以及 cloud 专用 Computer 的可见 Agent ACK。 |

## 五件套摘要

1. **报告人：** 用户在本机 MiniMax/Claude Code daemon 测试中发现不能发消息且本地命令不能连接 Computer。
2. **复现步骤：** Server 下发 Runtime 后由 Runtime 执行受控 `slock message send`；在 local-dev Computers UI 生成连接命令并执行。
3. **根因分析：** 见诊断胶囊第 3 栏；两个缺口位于相邻的产品控制/分发边界。
4. **修复方案：** 后端控制包加入唯一的产品默认 `allowWrites=true`；不更改 CLI fail-closed 语义；以已存在 distribution builder 生成 local test artifact，验证 package 和 UI 命令的端到端行为。
5. **验证方式：** 见诊断胶囊第 8 栏和 task `07-31-07-31-daemon-write-and-computer-connect` 的 `implement.md`。
