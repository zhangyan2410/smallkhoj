# Daemon connect maturity and onboarding hardening

## Goal

目前 daemon 连接仍处于测试阶段，并不成熟；需要把端口/serverUrl、connect token 生命周期、重连、错误提示、过期/已消费提示和 onboarding 流程作为后续产品化任务继续打磨。

## Requirements

- 明确标注并产品化处理：目前 daemon 连接仍处于测试阶段，并不成熟；后续需要系统性打磨端口/serverUrl、connect token 生命周期、重连、错误提示、过期/已消费提示和 onboarding 流程。
- 将 daemon 启动后收到 `SIGTERM` 的场景纳入诊断：区分正常的旧 daemon 单例清理、用户终止、锁文件冲突、控制面主动停机、runtime 子进程退出和异常崩溃。

## Acceptance Criteria

- [ ] `/computers` 连接命令在非默认后端端口下生成正确 `--server` 地址。
- [ ] connect token 过期、已消费、server 不匹配、错误后端端口时给出用户可理解的错误提示。
- [ ] daemon connect/reconnect 流程有真实浏览器 + API + daemon CLI 验证证据。
- [ ] daemon 启动/停止日志能说明 SIGTERM 来源，避免用户只看到 runtimes 被杀而无法判断是正常替换还是异常退出。
- [ ] UI 文案明确说明 daemon 连接仍处测试阶段，避免用户把它当作稳定路径。

## Observed Symptoms

- 2026-06-23: daemon 连接到 feature 后端后启动了 `minimax` / `glm1` 的 `claude_code` runtimes，随后两个 runtime 都收到 `SIGTERM`，daemon 输出 `Received SIGTERM` 并停止。
- 同日排查发现 `smallkhoj-daemon` wrapper 使用共享锁文件 `~/.smallkhoj/daemon.pid`；启动新 wrapper 会清理旧 wrapper 和其 runtime 子进程。这是测试阶段可接受但产品上不成熟的行为，需要更清晰的 UX 和诊断。
- main 合入后再次复现：新 token、空 lock 目录、main backend 下，wrapper 启动后 4-5 秒收到 `SIGTERM`。进一步对比发现 direct `node dist/cmd/main.js start ...` 能稳定运行，真正问题是旧的无效 connect command 周期性重试同 server wrapper，wrapper 先 kill 健康 daemon，再用旧 token 失败。

## Fix Applied 2026-06-23

- `smallkhoj-daemon` 默认锁从全局 `~/.smallkhoj/daemon.pid` 改为按 server URL 派生的 `~/.smallkhoj/daemons/daemon-<hash>.pid`。
- 保留 `SMALLKHOJ_DAEMON_LOCK` 精确覆盖，并新增 `SMALLKHOJ_DAEMON_LOCK_DIR` 方便隔离测试。
- 锁 key 使用规范化后的 server URL：去掉尾部 `/`，协议/host 小写，并将同端口的 `localhost` 与 `127.0.0.1` 视为同一后端。
- 不改变传给 daemon 的原始 `--server` 参数；规范化只用于 wrapper singleton lock。
- wrapper 不再自动清理/杀死同 server 的活进程；如果 lock 指向活 PID，直接退出并提示 server URL、PID 和 lock 文件路径。
- stale lock 仍会被清理，避免死 PID 阻塞启动。
- wrapper 的 connect/start 模式改为 `exec env ... node dist/cmd/main.js start --foreground ...`，真实 daemon 成为前台进程，减少 wrapper 父进程信号干扰。

## Verification 2026-06-23

- `bash -n smallkhoj-daemon` passed.
- `cd agent/daemon/aaa-daemon && rtk node --test test/smallkhoj-daemon-wrapper.test.mjs` passed: 4 tests.
- `cd agent/daemon/aaa-daemon && rtk npm run build` passed.
- `cd agent/daemon/aaa-daemon && rtk node --test test/daemon-runtime.test.mjs` passed: 14 tests.
- `cd agent/daemon/aaa-daemon && rtk node --test test/runtime-mcp.test.mjs` passed: 28 tests.
- `rtk git diff --check` passed.
- Independent verification subagent confirmed the initial server-scoped lock behavior and build/test pass; final local verification additionally covered `localhost` vs `127.0.0.1` normalization and fake-wrapper process replacement.
- Real wrapper verification on main backend: fresh `smallkhoj-daemon connect` stayed alive beyond the previous 4-5 second SIGTERM window; a second invalid same-server wrapper exited with code 3 and did not kill the healthy daemon.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
