# 真实 runtime 链路验证报告(2026-08-02)

> 替代之前用 bridge 空壳 colleague 的错误测试。这次走真实 daemon + agent runtime 链路。
> 环境:38190 caddy 栈,后端 `smallkhoj-backend:main-head`(main HEAD `fddcf2e` 重新 build),前端 worktree `feperf-test` 镜像。
> agent:`cc`(MiniMax provider,claude_code runtime,pid 67060 真实 Claude Code 进程)。

## 验证链路(全部真实,无空壳)

### 1. daemon 连接 ✅
- computers 页 reconnect glm1 → 跑 connect 命令 → daemon WS Connected
- glm1 status=**online**, activeDaemon=`43a962db`

### 2. cc runtime 启动 ✅
- POST `/workspaces/{id}/lifecycle` {action:start} → delivered:1
- cc workspace status=**running**, pid=67060(真实 `claude --dangerously-skip-permissions ...` 进程)

### 3. 人↔agent DM 真实回复 ✅
- zy-ean 发 DM(marker REAL_RUNTIME_DM_1785647826)→ cc **15s 内真实回复**:
  - seq 8: "你好 zy-ean!我在线,连接正常 ✅ 我是 cc,刚完成了启动自检..."
  - seq 10: "收到 👍 在线正常,随时待命。"
- 满足 `docs/real-runtime-dm-reply-sop.md`:browser DM → real runtime → 真实回复。

### 4. SSE 未读 + self-filter(真实链路验证)✅
**store count 精确等于 cc(agent)回复数,zy-ean 自发消息被正确排除:**
- cc DM(ee46f090)store count = **2**
- cc(agent)真实回复数 = **2**(seq 8、10)
- zy-ean(human)自发数 = **3**(seq 2、7、9)—— **全部被 self-filter 排除,未计入**

**结论:self-filter 逻辑正确。之前报的"bug1 自发消息被计入"是误判**(用空壳 colleague 测 + 查询条件错),真实 agent 链路下完全正常。

### 5. task 分发链路 ✅
创建 task 分配给 cc → cc **自动认领并处理**,全程 task.* 事件推送:
- `task.created`(actor=zy-ean)
- `task.updated` status=**in_progress**(actor=cc,自动认领)
- `task.updated` status=**in_review**(actor=cc,处理完提交)
- `task.memory_requested`(cc 请求记忆)

cc agent 真实接收 task → 认领 → 执行 → 提交 review,事件链路正常。

---

## 仍确认存在的 bug

### Bug A(后端,main HEAD 复现):进 DM 后未读清不掉
- 根因:`backend/services/public_events.py` `_event_scope()` 对 message.* 事件 scope.kind 硬编码 "channel",不区分 DM。
- main-head 实测事件:`scope: {"kind": "channel", "id": "...", "name": "dm:@zy-ean"}`(DM 被标 channel)。
- 前端清除用 kind="dm",递增用 kind="channel",key 不匹配 → 进 DM 清不掉未读。
- 详见 `REAL_bug-report-20260802.md`。

### Bug B(前端,派生):徽标数字虚高
- 因 Bug A 致 store 只增不清,app-rail.tsx 聚合所有 chat: 键 count,数字虚高。修 A 即好。

---

## 推翻的误报(更正)
- ~~bug1:自己发的消息被计入未读~~ → **不是 bug**。真实链路下 self-filter 正常(zy-ean 3 条自发全排除,count=cc 2 条回复)。之前是空壳 colleague + 查询错的误判。

## 未完成 / 受阻
- **多 tab SSE 连接数**:session 不稳定(tab 频繁跳 /login),2 个 tab 都掉登录,SSE 未真正建立,无法可靠测多消费者连接数。需先解决 session 稳定性。
- **session 频繁失效**:zy-ean 的 cookie session 在操作间隔稍长(>10-15s)就掉,反复跳 /login。可能是 BETTER_AUTH 配置或 cookie 有效期问题,值得排查。

## 环境声明
- local-dev(38190 caddy 栈)。无 local-prod/cloud-prod 声明。
- daemon + cc runtime 真实运行(Claude Code pid 67060)。
- 未提交代码。

## 关键文件
- daemon 日志:`/Users/lee/.zcode/cli/exec/.../call_d5725e0cb396439f886f69bb-stdout.log`
- bug A 详报:`REAL_bug-report-20260802.md`
- 后端 event_records / messages:sk-feperf-db-1 容器内可查
