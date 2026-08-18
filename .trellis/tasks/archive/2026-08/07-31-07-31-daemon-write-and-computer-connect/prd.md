# 修复 daemon 写权限与本地/云端 Computer 连通性

## 目标

恢复产品管理的 Agent Runtime 发送 Slock 消息的默认能力，并以真实产品路径分别证明：本地 Server 能注册并控制本地 Computer，云端 Server 能控制指定的云端测试 Computer。用户不应再因为一次性 Computer 命令、Runtime 写门禁或错误的环境边界而无法完成测试。

## 已确认事实

- `c33a0a38` 将 daemon 托管 Runtime 的写操作从隐式允许改为 fail-closed；只有 CLI `--allow-writes` 或 `start_runtime.config.allowWrites: true` 才会注入 `SLOCK_ALLOW_WRITES=1`。这个 daemon 安全边界本身正确。
- 正常产品路径是：UI 生成 `aura --server-url ... --api-key ...` → daemon 以 `runtime=none` 连入 → 后端 `runtime_start_command()` 下发 `start_runtime`。后端 [`backend/services/daemon_control.py`](/Users/code/project/smallkhoj/backend/services/daemon_control.py:52) 的 control config 当前没有 `allowWrites`；daemon 已在 [`agent/daemon/aaa-daemon/src/daemon/daemon.ts`](/Users/code/project/smallkhoj/agent/daemon/aaa-daemon/src/daemon/daemon.ts:859) 正确消费该字段。
- 本地和云端是不同数据库和 WebSocket 控制面。云端正在使用的 Computer/Workspace 不存在于本地数据库，因此本地命令不能、也不应尝试控制云端 Computer。
- 本地可见 UI 已生成真实一次性连接命令，但命令请求的本地 npm tarball 返回 `404`：当前后端宣告 `0.2.1`，本地 `release-artifacts/smallkhoj-daemon/` 只有旧 `0.2.0` 包。`install.sh` 可访问并不代表 npm package 可访问，daemon 尚未启动就退出，故没有 Computer 注册。
- 云端 `http://124.222.40.40` 的 `/docs`、`install.sh` 和当前 `0.2.1` npm package 均返回 `200`；本地 artifact 缺失不能推导为云端 artifact 缺失。
- 现有单层测试覆盖“未 opt-in 时拒绝写”和“直接 CLI opt-in 时允许写”，但没有覆盖“后端生成的动态 `start_runtime` control 包带默认写授权”；静态挂载测试只断言路由存在，未覆盖所宣告 package 的实际可下载性。

## 需求

- **R1 — 产品 Runtime 默认可写：** `runtime_start_command()` 对 Server 管理的 Runtime start/restart 必须下发 `config.allowWrites = true`。
- **R2 — 保持最小安全边界：** 独立 CLI/daemon 启动在缺少显式 CLI/config opt-in 时仍必须 fail-closed；本修复不得把所有 daemon Runtime 无条件变为可写。
- **R3 — 后端到 daemon 的真实合同：** `start_runtime.config.allowWrites: true` 必须在目标 Runtime 的环境与 `.slock` wrapper 中形成 `SLOCK_ALLOW_WRITES=1`，并允许一条受控的 `slock message send`；无该字段的 payload 仍必须被拒绝。
- **R4 — 本地产品连接可执行：** 本地验证前必须生成与后端宣告版本一致的 npm daemon package，并从本地 UI 使用新签发、一次性的本地 connect ticket 启动隔离 daemon。它必须注册本地 Computer、建立 lease/WebSocket，并接收本地 Runtime control command；不得复用云端 Computer、云端 ticket 或失效 ticket。
- **R5 — 云端真实验证：** 在已指定的云端测试 Server/Computer 上，验证在线 lease、收到 control command、Runtime 启动，以及一条最小化的 Agent 回信。验证只使用受控测试目标并尽量减少 MiniMax token 消耗。
- **R6 — 修复门禁缺口：** 增加针对 R1/R3 的回归测试，并将“生成命令所宣告 package 必须实际可下载”的检查纳入本地真实测试/发布验证证据；不能仅以 mount、单元字典或 daemon 独立测试通过作为交付结论。

## 约束

- 不在聊天、task 文件、截图、日志或 commit 中暴露 connect ticket、machine token、认证 cookie、代理 token、个人路径或真实消息正文。
- 本地测试使用唯一 Computer、machine identity、工作区根目录和 Runtime marker；云端测试使用现有专用测试目标与单条无敏感内容 marker。
- 本地通过不等于云端通过。两侧证据必须明确标注控制面和目标。
- 浏览器可见验收使用 `./twd`；Playwright 可作确定性集成测试，但不替代可见 UI 证据。
- 不将为了本地测试而生成的 ignored release artifact 纳入源码提交；生产 artifact 仍按既有 release pipeline 发布。

## 验收标准

- [ ] **AC1**：`runtime_start_command()` 的 start/restart control envelope 含 `config.allowWrites is True`。
- [ ] **AC2**：daemon 动态 control 集成测试证明带 `allowWrites: true` 的 payload 使 Runtime 环境、生成 wrapper 与受控 `message send` 都可写。
- [ ] **AC3**：同一测试族证明不带该字段时写操作仍返回写门禁错误。
- [ ] **AC4**：本地 UI 生成的 npm package URL 返回非空 `2xx`，新的本地 ticket 可启动隔离 daemon 并在本地 UI/API 显示在线 Computer 与活动 daemon lease。
- [ ] **AC5**：本地 Server 对该 Computer 下发 `start_runtime`，daemon 日志与 Runtime 状态显示已接收、启动；该路径未消耗云端模型配额。
- [ ] **AC6**：云端专用测试 Computer 保持在线，收到修复后的 control command 并完成一条浏览器可见、Agent 署名的最小回信。
- [ ] **AC7**：测试/发布门禁记录清楚区分：daemon 的 fail-closed gate 一直有效，遗漏的是产品 control-plane 默认值和版本化 package 的端到端可用性检查。
- [ ] **AC8**：没有泄露或复用任何敏感凭据，也没有影响非测试 Computer、账户或 Runtime。

## 不在范围内

- MiniMax 延迟、性能调优或配额策略。
- 将直接 CLI 启动的所有 Runtime 改为默认可写。
- 广泛重写 Computer 认证、租约或多用户账号设计。
- 将本地临时 release artifact 提交进 Git。
