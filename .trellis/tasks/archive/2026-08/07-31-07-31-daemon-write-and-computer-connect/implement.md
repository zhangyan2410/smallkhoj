# 实施与验证计划

## 前置

- [ ] 在隔离 worktree 中执行源码改动；保留当前根工作区的用户改动和临时 artifact。
- [ ] 读取 backend、daemon 和 release-pipeline 适用 spec；启用 TDD。
- [ ] 记录本地与云端的运行前状态、版本、监听端口、Computer/lease 状态，不记录凭据。

## 红灯：自动化回归

- [ ] 在 `backend/tests/test_daemon_control.py` 写失败测试：`runtime_start_command()` 生成的 `command.config.allowWrites` 为 `True`，且既有 runtime/provider/路径字段不丢失。
- [ ] 在 `agent/daemon/aaa-daemon/test/daemon-runtime.test.mjs` 的动态 `start_runtime` 场景写失败测试：带 `allowWrites: true` 的 control payload 使 fake Runtime 看见 `SLOCK_ALLOW_WRITES=1`、wrapper 含 gate、受控 `slock message send` 抵达 fake upstream。
- [ ] 保留或显式新增反向断言：没有 `allowWrites` 的动态 payload 返回 `WRITES_NOT_ALLOWED`，防止把 CLI 路径错误地全局放开。
- [ ] 补充 release/package 合同测试：后端默认宣告版本与 daemon package 版本一致；发布构建输出包含同名 npm `.tgz`。本地真实测试还必须 HTTP probe 该文件，不以 mount-only 测试代替。

## 最小实现

- [ ] 仅在 `backend/services/daemon_control.py:runtime_start_command()` 的 `config` 构造中加入 `config["allowWrites"] = True`。
- [ ] 若 package 版本合同测试发现真实源码不一致，修复单一版本来源；不把本地绝对路径或 `--allow-writes` 加到产品 connect 命令。
- [ ] 不修改 daemon 的 fail-closed 判定，除非红灯证明其无法消费已有 `allowWrites` 字段。

## 自动化验证

- [ ] `rtk` 执行新增 backend 测试与相邻 daemon control 测试。
- [ ] 执行 daemon 全测试族或其最小可验证子集，并记录通过的具体测试名。
- [ ] 执行 package builder 测试、post-deploy smoke 测试和 release/version 合同测试。
- [ ] 运行受影响 Python/TypeScript 静态检查；若修改发布脚本，运行对应脚本 tests。

## 本地真实验证（无云端 token 消耗）

- [ ] 启动并保持本地 backend `:8000` 与 frontend `:3000`；将 daemon 固定到临时 machine-id、workspace root、lock/pid 目录。
- [ ] 用 `scripts/build_daemon_distribution.py` 生成当前版本的 `release-artifacts/smallkhoj-daemon` package；HTTP 检查 UI 宣告的 package URL 返回非空 `2xx`。
- [ ] 用 `./twd` 在本地 `/computers` 生成新、唯一的连接命令；不得打印或保存 ticket。
- [ ] 在临时目录执行该 UI 命令，等待 `/daemon/connect`、WebSocket、Computer lease；可见 UI 与本地 DB/API 证明 Computer online。
- [ ] 在同一 local Computer 上创建最小受控 Agent/Runtime，确认后端下发 payload、daemon 接收、Runtime wrapper/env 获得写 gate，并完成一条带唯一 marker 的本地 Agent reply。
- [ ] 将可见 UI snapshot/screenshot、HTTP 状态、daemon timeline 和不含敏感内容的 DB counts 写到 task evidence；停止临时 daemon 并清理 local test Computer/Runtime 或明确记录其状态。

## 云端真实验证（只在本地完成后）

- [ ] 按项目 release 流程部署已验证后端；在部署前后分别检查云端 `0.2.1` package、`/docs`、指定测试 Computer lease 与 daemon version。
- [ ] 使用云端专用测试 Server/Computer 发出一次 `start_runtime` 或安全的 Runtime restart，确认 live daemon 收到 `allowWrites: true`。
- [ ] 从云端 UI 向专用测试 Agent 发送一条最小唯一 marker；只要求一条 Agent 回复，回复包含对应 ACK marker。
- [ ] 以 `./twd` 记录云端浏览器中的 Computer/runtime 状态和 Agent 署名回复，并以 cloud trace/control timeline 交叉验证。
- [ ] 若 cloud reply 失败，保留代码、控制包和 daemon trace 证据，回到根因阶段；不得以本地成功宣称线上完成。

## 风险与回滚点

- **Connect ticket 是一次性：** package HTTP probe 与 daemon binary 准备必须先完成，再生成 ticket；每次失败使用全新的 ticket。
- **模型成本：** local 使用 fake/最小 runtime；cloud 仅对专用测试对象发送一条短消息。
- **Worktree/环境隔离：** 本地临时 daemon 不使用当前云端 machine identity、runtime目录或 lock；删除 ignored artifact 不会影响 Git。
- **回滚：** 后端变更可单独回滚；daemon CLI 默认安全语义不可因为回滚而改变。
