# 2026-08-01 TWD 修复与真实交付闭环完整总结

## 1. 这次工作的目标

最初问题不是简单的“`./twd` 有一个报错”，而是 SmallKhoj 已经积累了很多测试、
截图和说明，但在复杂修改后仍然无法回答下面几个问题：

1. Agent 操作的是不是目标 worktree 的应用？
2. TWD 返回成功时，脚本是否真的执行完成，而不是 timeout 被包装成成功？
3. 多个 TWD bridge 和多个 Chrome tab 同时存在时，是否选中了正确目标？
4. 截图显示了一个页面，能否证明 Server、Computer、Agent、Channel、Task 和
   runtime 消息链路都是真的？
5. 自动 Gate 失败时，究竟是产品失败，还是证据采集器自己产生了假阴性？

因此完成标准被定义为：先修复 TWD 的证据真实性，再从 feature worktree 启动真实
SmallKhoj，创建真实资源、发送真实消息、收到真实 Agent runtime 回复，并用浏览器、
API、PostgreSQL、daemon 日志、runtime trace 和 Integration Gate 交叉证明。

## 2. 隔离开发现场

代码没有写进 dirty main，而是在 sibling worktree 中完成：

```text
worktree: /Users/code/project/smallkhoj-repair-twd-evidence-runtime-loop
branch: feat/repair-twd-evidence-runtime-loop
task: .trellis/tasks/08-01-repair-twd-evidence-runtime-loop
```

本次没有 commit、push 或 merge。主工作区原有的未提交修改被保留。

## 3. 修复前确认的核心缺陷

### 3.1 timeout 会被包装成成功

原来的 `tmwebdriver_core.py` 在没有 ACK、ACK 后没有 result、页面 reload 等情况下，
可能返回普通诊断字典。上层 `twd.py` 只看到一个 truthy object，于是输出：

```json
{"ok": true}
```

并退出 0。对证据工具来说，这是最严重的一类问题：没有完成的动作被声明为成功。

### 3.2 自动发现先选 bridge，再找目标 tab

SmallKhoj 后来增加了多个 TWD port 的自动发现，但逻辑是先选第一个有 tab 的
bridge，再在里面找 `--tab` 或 `--url-match`。如果目标 tab 在第二个 bridge，命令会
错误失败；如果第一个 bridge 有相似页面，还可能操作错误候选。

### 3.3 Guard 只验证 path，没有完整验证 URL

旧 Guard 对导航结果的判断不完整：

- 相同 pathname 的 cloud 页面可能被当成本地页面；
- 目标 query 为空时，意外 query 不会被拒绝；
- `goto` 后只探测一次，页面仍在跳转时可能误判；
- login recovery 和后续 eval 没有在每一个 payload 上重新确认 exact tab。

### 3.4 CLI 可靠性问题

- `--compact` 在部分错误路径失效；
- 放在子命令后面时不能正常解析；
- `act --cleanup-after` 传了 driver 不支持的 `args=`，并吞掉异常；
- `groups --collapsed false` 因 Python `bool("false")` 变成 `true`。

## 4. TWD 与 Guard 的修复

### 4.1 执行生命周期改为失败关闭

`agent/daemon/webdriver/tmwebdriver_core.py` 现在：

- 为每次执行注册 pending ID；
- 分开等待 ACK 和最终 result；
- no-ACK、ACK-without-result、reload 分别抛出带稳定 code 的异常；
- 在 `finally` 清理 pending、ACK 和 result；
- 迟到 ACK/result 只有在执行 ID 仍属于 pending 时才接收；
- timeout 后到达的旧结果不能完成或污染下一次调用。

`agent/daemon/webdriver/twd.py` 统一把异常转换为：

```json
{"ok": false, "code": "EXECUTION_TIMEOUT", "message": "..."}
```

并返回非零退出码。

### 4.2 bridge 选择改为 target-aware

自动发现现在先收集全部候选 bridge 的 session，再按目标选择 owner：

1. 显式 `--port` / `TWD_PORT` 永远优先；
2. `--tab` 查找拥有该 exact tab 的 bridge；
3. `--url-match` 查找拥有匹配 URL 的 bridge；
4. 多个 bridge 同时拥有匹配目标时返回 `AMBIGUOUS_BRIDGE`；
5. 没有 owner 时返回 `NO_MATCHING_BRIDGE`，不选择无关 bridge；
6. `tabs` 聚合全部 live bridge，并记录 source port。

### 4.3 导航与 exact-tab 证明

`tools/twd-guard/twd-auth-guard.mjs` 现在：

- 比较完整的 `origin + pathname + search + hash`；
- 在同一个 exact tab 上有界轮询，直到目标 URL 和 readyState 稳定；
- cookie injection、navigation、业务 eval、final probe 每一步都检查返回 `tabId`；
- 只有目标 frontend origin 上的 `/login` 才允许 trusted re-auth；
- `chrome-error://` 或错误 origin 会先进行无 token probe，然后在同一 tab 导航到
  本地 `/login`；确认 origin 后才获取并注入 session token；
- token-bearing command 失败时不保留 argv、token 或原始 error cause。

### 4.4 CLI 契约修复

- `--compact` 在子命令前后都可用；
- 成功和 handled failure 都是一行 JSON；
- `goto` 只接受明确的浏览器导航 acknowledgement；
- `act` action failure 保留原始 code，cleanup failure 为 `CLEANUP_FAILED`；
- cleanup selector 被序列化进 JavaScript，不再传 unsupported driver args；
- `groups --collapsed` 使用严格文本布尔解析，并拒绝非法输入。

## 5. 第一次真实运行暴露的新问题

TWD 自动测试通过以后，没有直接宣布完成，而是启动 feature worktree 的真实环境：

```text
Backend:   http://127.0.0.1:18000
Frontend:  http://127.0.0.1:13000
Postgres:  disposable container, host 55439
TWD:       WS 28765 / HTTP 28766
Daemon:    proxy http://127.0.0.1:62255
Exact tab: 1617512975
```

第一次尝试过程中，浏览器 tab 因服务重启变成
`chrome-error://chromewebdata/`。旧 Guard 会先获取 token 再注入，既失败又有泄漏
风险。该问题被加入 Guard RED 测试，修复为“先无 token 恢复正确 origin，再认证”。

## 6. 真实 Computer、Agent、Channel、Task、Chat 闭环

最终真实 marker：

```text
TWD_LOOP_20260801142749
```

创建并对账的资源：

```text
Server:        cd849e71-a112-4616-a22c-47e69f217d0e
Computer:      10bd4b45-ad8c-4e0b-a877-81e9163b1134
Agent:         fb1dfb45-5fab-454b-9adc-1557eabd914f
Workspace:     ef7f0b04-2282-49bf-925b-13841ecba687
Channel:       5e20e51a-db54-4488-bcbc-fc66ba261251
Human message: 99a449f0-8cdc-40b9-bc5a-6bc474ab4672
Agent reply:   a11e4520-c708-4819-be5d-6777a49d2d3f
Task:          ca0116a0-683d-4b97-ba4d-f45d5974aa84
```

真实结果：

- Computer 和 Agent 在线；
- Channel 中有 human 与 Agent 两名成员；
- human 消息包含 marker；
- Agent reply 是 human 消息的线程回复，内容为
  `ACK_TWD_LOOP_20260801142749`；
- Task 分配给该 Agent，状态为 `in_review`；
- UI、API、PostgreSQL 和 runtime trace 中的资源 ID 一致；
- runtime trace 显示真实 model/runtime 完成，不是 fake recorder 或手工 POST。

## 7. 真实 timeout 验证

在 exact tab `1617512975` 上执行一个浏览器端延迟 1.2 秒、TWD timeout 0.25 秒的
只读 eval：

```json
{"ok":false,"code":"EXECUTION_TIMEOUT"}
```

进程退出码为 1。等待迟到 result 到达后，在同一个 tab 上再执行新 eval：

```json
{
  "ok": true,
  "tabId": "1617512975",
  "result": {
    "marker": "AFTER_TIMEOUT_TWD_LOOP_20260801142749",
    "path": "/chat/twd-loop-142749",
    "title": "Chat - SmallKhoj"
  }
}
```

这证明 timeout 的旧结果没有污染后续调用，tab 仍可继续使用。

## 8. Integration Gate 假阴性与第二轮修复

真实回复已经进入 UI、API 和数据库，但第一次 Gate 只有 10/11：

```text
code: SLOCK_SEND_MISSING
```

根因不是产品没有回复，而是 daemon activity 的 `commandPreview` 先执行 200 字符
截断。真实命令以非常长的路径开始：

```text
.../.slock-runtimes/<server>/<computer>/<workspace>/.slock/slock message send ...
```

路径在 `.slock/slo…` 位置就被截断，Gate 看不到后面的 `message send`。

修复方式：

- 新增真实长度的 RED 回归；
- 在截断前把生成式 `.slock/slock`、`.cmd`、`.ps1` wrapper 路径规范化为语义命令
  `slock`；
- 不放宽 Gate 的匹配条件，也不延长 timeout 来掩盖问题；
- rebuild/restart daemon，换新 marker 重跑真实 Gate。

修复后的结果：

```text
marker:  TWD_GATE_REPAIR_202608011500
runId:   chat-gate-msa0udpg
traceId: chat-gate:chat-gate-msa0udpg
mode:    chat-reply-channel-base
result:  11/11 passed
reply:   ACK_TWD_GATE_REPAIR_202608011500
```

Gate 报告总体 `status=warning`，唯一警告是
`CONTEXT_EVIDENCE_MISSING`，因为没有提供 `/context` artifact。该能力没有被声明为
已验证。

## 9. 自动化门禁结果

聚焦门禁：

```text
TWD Python:           34 passed
TWD Guard Node:       30 passed
Inkframe proof:       13 passed
Integration Gate:     39 passed
Daemon:               281 passed
```

最终 disposable PostgreSQL 环境下的 canonical `make ci`：

```text
Backend:              524 passed
Frontend:             222 passed
Scripts:              171 passed, 1 skipped
Alembic upgrade/check PASS
Ruff PASS
ESLint PASS
TypeScript + E2E typecheck PASS
Next production build PASS
Compose config PASS
git diff --check PASS
```

`make ci` 前两次退出也被保留说明：第一次缺少
`E2E_DATABASE_SCOPE=disposable`；第二次 migration template 的数据库名只有 `ci`
标记，而 destructive fixture 要求 `test/audit/remediation/disposable`。两次都是安全
环境门禁拒绝执行，不是候选代码回归。修正为安全数据库名后全量通过。

## 10. 证据安全与环境清理

持久 evidence 扫描没有发现以下凭据模式：

```text
session/connect/machine/agent/provider token
AUTH_BRIDGE_SECRET
Authorization: Bearer
```

Computer API evidence 中的 machine-token prefix 已脱敏。根目录没有媒体垃圾，证据
保存在 task evidence 目录。

结束时已完成：

- 停止 feature backend、frontend、daemon、managed runtime、TWD；
- 删除 disposable PostgreSQL container；
- 删除 task-scoped `.runtime`、`.slock-runtimes` 和临时 PID 文件；
- 从 main worktree 恢复原 TWD master；
- `./twd --compact tabs` 重新看到 7 个 Chrome tab；
- 保留主工作区所有原有 dirty 修改。

## 11. 修改范围

主要实现/回归文件：

```text
agent/daemon/webdriver/tmwebdriver_core.py
agent/daemon/webdriver/twd.py
agent/daemon/webdriver/test_twd_selection.py
tools/twd-guard/twd-auth-guard.mjs
tools/twd-guard/twd-auth-guard.test.mjs
agent/daemon/aaa-daemon/src/daemon/daemon.ts
agent/daemon/aaa-daemon/test/runtime-mcp.test.mjs
Makefile
.trellis/spec/frontend/quality-guidelines.md
.trellis/spec/backend/event-delivery-contracts.md
docs/bug-report/twd-evidence-runtime-loop/bug-report.md
```

## 12. 已知边界与没有完成的部分

- 只验证了 `local-dev`，没有验证 `local-prod` 或 `cloud-prod`；
- Task 的 `tasks.message_id` 仍为 `NULL`，`data.source` 记录了 Channel 来源；这是
  既有 source-linkage 问题，没有在 TWD 修复中扩 scope；
- `/context` artifact 未提供，所以 context evidence 保持 warning；
- 修复和 evidence 仍在 feature worktree，尚未 commit、push、PR 或 merge；
- 整次运行依赖执行 Agent 手工编排环境、fixture、证据和 cleanup，因此它是可信的
  一次性验收基线，不是可供其他 Agent 直接复现的 Workflow。

## 13. 对新 Workflow 的直接输入

新 Workflow 不需要重新发明 TWD、Guard、Gate 和 trace；它需要把这次人工步骤变成：

```text
prepare manifest
  → isolated candidate + ownership ledger
  → exact-tab pin
  → real fixtures + runtime
  → marker message + ACK
  → UI/API/DB/trace/Gate reconcile
  → report.json + report.zh-CN.md
  → guaranteed cleanup
  → Codex/Claude fresh-agent cold runs
```

这份总结就是 `local-core` 的历史基线：未来 runner 产出的报告至少要达到本次证据
强度，同时把临场命令、隐含顺序和人工提醒降到零。

## 14. 原始证据位置

在 feature worktree 未清理前，完整原始 evidence 位于：

```text
/Users/code/project/smallkhoj-repair-twd-evidence-runtime-loop/
  .trellis/tasks/08-01-repair-twd-evidence-runtime-loop/evidence/
```

关键文件：

```text
quality-gate.md
TWD_LOOP_20260801142749/notes.md
TWD_LOOP_20260801142749/twd-timeout.txt
TWD_LOOP_20260801142749/integration-gate.json
TWD_LOOP_20260801142749/integration-gate-pass.json
TWD_LOOP_20260801142749/chat-final.png
TWD_LOOP_20260801142749/task-final.png
TWD_LOOP_20260801142749/chat-gate-pass.png
TWD_LOOP_20260801142749/api-*.json
TWD_LOOP_20260801142749/db.txt
TWD_LOOP_20260801142749/daemon-logs.json
TWD_LOOP_20260801142749/trace.txt
```
