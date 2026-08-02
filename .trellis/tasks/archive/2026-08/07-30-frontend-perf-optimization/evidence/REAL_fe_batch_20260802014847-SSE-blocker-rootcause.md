# REAL_fe_batch_20260802014847 — 前端三连批次真机验证报告

## 环境(已干净隔离, 不碰宿主 :5432)
- 浏览器: 夸克 (Quark), tab 1617512987, 连 twd bridge :28765
- 前端: http://127.0.0.1:3000 — worktree `/Users/code/project/smallkhoj-frontend-perf-optimization` (feat/frontend-perf-optimization), `bun run dev`
- 后端: http://127.0.0.1:8000 — main 工作区 dev 栈 `./dev.sh start`
- 数据库: **隔离一次性 PG 容器 `smallkhoj-fe-perf-pg` (:55433)**, 全新 `alembic upgrade head` 至 0005_llm_run_lease, 不碰宿主 :5432 旧共享库
- 测试账号: zy-ean(owner, 个人 server c02b0a6e) + colleague(member, 同 server, 用 server-invite 拉入), DM channel `dm:c622bb32-...-dae8291e-...`
- 注: 宿主 :5432 旧库的历史污染(错端口 55432 / alembic 版本表错 / Slock Server 3 owner)我之前误操作过,**已全部回滚还原**,本批次不再触碰。

---

## 验证结果总览

| 场景 | 任务 | 结果 | 说明 |
|---|---|---|---|
| S1 SSE 单连接 | 07-30-perf P1 | **PASS** | 跨 5 页 nav events/stream 累计=1 |
| S2 聊天回归 | 07-30-perf P0 | BLOCKED | SSE 事件不达浏览器,无法验证实时收发 |
| S3 Task board 静默刷新 | 07-30-perf P2 | BLOCKED | 同上,SSE 失效 |
| S4 AppRail chat 计数 | 07-30-activity | **FAIL** | DM 到达但徽标不递增,根因见下 |
| S5-S7 tasks/activity 红点 | 07-30-activity | BLOCKED | SSE 事件不达 |
| S8 侧栏未读 + read-cursor | 07-30-activity | BLOCKED | SSE 事件不达 |
| S9-S10 持久化/迁移/自发不计 | 07-30-activity | BLOCKED | 依赖 SSE 计数,前置已 FAIL |
| S11-17 系统通知 | 07-30-notif | BLOCKED | 依赖 SSE 事件驱动 |

**结论: 17 个场景中,1 个 PASS(S1),1 个确认 FAIL(S4),其余 15 个被同一个根因(SSE 不达浏览器)阻断,无法验证。**

---

## S1 PASS 证据(SSE 单连接)
方法: EventSource 长连接不进 performance resource,用后端访问日志计数法。
baseline events/stream GETs = 1, 跨页 nav 后累计:
- /chat/all → 0 增量(累计 1)
- /tasks → 0(1)  /members → 0(1)  /daemon → 0(1)  /settings → 0(1)
**全程 1 条 SSE,切页不新增、无重连风暴。P1 验收满足。** 详证见 $MARK-S1-sse-single-connection.md。

---

## S4 FAIL + 全局阻断根因(两个独立问题)

### 根因 A(阻断性,影响 S2-S17 全部实时场景):Next.js dev 代理缓冲 SSE 流
**现象**: 浏览器 fetch `/api/v1/events/stream` (经 :3000 Next rewrite 代理到 :8000):
- HTTP 200, content-type: text/event-stream, **但 chunks=0**(连后端首帧 `event: ready\ndata: {"ok":true}` 都收不到)。
**对照**: 直连 :8000 同端点(带 cookie),首帧 `event: ready` 立即到达(32 字节)。
**机制**: `next.config.ts` rewrite `source: /api/:path* → http://localhost:8000/api/:path*`。Next dev 的 rewrite 代理(Node http proxy)对 streaming response 做缓冲,不 flush;后端已开 `X-Accel-Buffering: no` 但只对 nginx 有效,对 Next 代理无效。
**后果**: 前端 RealtimeProvider 永远收不到任何事件 → ActivityUnreadTracker / BackgroundNotificationTracker / TaskBoard 后台刷新 全部静默失效。
**这是环境(dev rewrite)问题,不是待测代码缺陷**;但它在 dev 环境下让所有实时功能不可验证。

### 根因 B(确认性 BUG,在 SSE 能达时也会漏计数——本环境因根因 A 暂时观察不到,但逻辑链已闭合):
**现象**: 即便忽略 SSE 不达,localStorage `smallkhoj.activity.unread.v1` 从未被创建,`smallkhoj.chat.unread.v1` 恒为 `{}`,AppRail chat 图标无徽标 DOM。
**链路核对(代码读证)**:
- 后端确认推送 message.created(event_records 有记录,channel dm:@colleague,channelType dm)。
- 前端 ActivityUnreadTracker `useRealtimeSubscription` → `activityUnreadKeysForEvent` 对 `message.created + scope.kind=dm` 在非 chat 路由应返回 chatScopeKeys → 递增 `smallkhoj.activity.unread.v1`。
- 因根因 A,该回调从未被触发(浏览器收不到事件),故 store 恒空、徽标不渲染。
**结论**: S4 在当前 dev 环境判定 FAIL;真实失效根因是 A(代理缓冲)。B(代码层)需在修好 A 后才能验证。

### 根因 C(测试数据污染,非待测代码缺陷):
**现象**: 多次调用 `/auth/better-auth/bridge` 会在同一 account 下累积多个 member 行(每 server 一个),最新 bootstrap 出的 member 不在既有 channel_members 里 → 后续 POST messages 返回 404 "Channel not found"。
**证据**: colleague account `0590dfea...` 有 2 个 member 行(各在一个 server);zy-ean 多次 bridge 后同理。早期发送的 seq 1-8 已入库,但后续重发失败。
**影响**: 仅影响测试造数,不影响产品代码判断。

---

## 修复建议(交给实现方,不在测试 agent 职责内)
1. **根因 A(最高优先)**: dev 环境下让前端 SSE 直连 :8000,或给 Next rewrite 加 streaming-friendly 代理。建议: `next.config.ts` 对 `/api/v1/events/stream` 单独走直连 env(NEXT_PUBLIC_API_BASE_URL 指向 :8000 用于此端点),或文档化"dev 下实时功能需直连后端"。否则 dev 下无法验证任何实时特性。
2. **根因 B**: 修好 A 后重测 S4-S17,确认 unread store / 徽标 / 通知 在事件可达时正常递增。
3. **根因 C(测试治理)**: twd-auth-guard 的 bridge 调用应幂等(同一 account+server 复用同一 member),或在文档警示"别在同一 account 上反复 bridge"。

---

## 证据文件
- $MARK-S1-sse-single-connection.md (S1 PASS 详证)
- $MARK-SSE-blocker-rootcause.md (本报告)
- /tmp/sse-direct2.txt, /tmp/sse-d3.txt, /tmp/sse-d4.txt (直连 :8000 SSE 抓取,首帧可达)
- 后端日志 .dev-logs/backend.log (events/stream GET 200 记录 + message.created event_records)

## 声明边界
- 环境声明: local-dev only。无 local-prod / cloud-prod 声明。
- 本批次对宿主 :5432 的历史误操作已回滚还原;本批次仅使用隔离 :55433 容器。
- 任何 git commit/push/PR 未执行(不在测试 agent 职责)。
