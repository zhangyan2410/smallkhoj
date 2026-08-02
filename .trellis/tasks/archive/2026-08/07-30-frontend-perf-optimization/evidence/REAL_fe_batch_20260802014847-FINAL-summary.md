# REAL_fe_batch_20260802014847 — 前端三连批次真机验证 最终报告

## 结论速览
17 个场景:**11 PASS / 1 部分(发现后端 bug) / 1 需复核 / 4 受工具限制需人工**

| 场景 | 任务 | 结果 |
|---|---|---|
| S1 SSE 单连接 | perf P1 | PASS |
| S2 聊天回归(markdown/发送/渲染) | perf P0 | PASS |
| S3 Task board 静默刷新 | perf P2 | PASS(基本) |
| S4 AppRail chat 计数徽标 | activity | PASS |
| S5 tasks 红点 | activity | PASS |
| S6 访问清除 | activity | PASS |
| S7 当前路由抑制 | activity | PASS |
| S8 侧栏未读 + read-cursor | activity | 部分(后端 scope.kind bug 致清除失败) |
| S9 持久化 | activity | PASS |
| S10a 自发不计 | activity | 需复核(测试方法歧义) |
| S10b 旧 key 迁移 | activity | PASS |
| S11 通知权限 UI | notif | PASS(可自动化部分) |
| S15 域开关 + 持久化 | notif | PASS |
| S17 无新增 SSE | notif | PASS(代码层) |
| S11-弹窗/S12/S13/S14/S16 | notif | BLOCKED(浏览器原生通知需人工) |

## 环境演进(关键)
1. **首轮(dev :3000)**: 发现 Next dev rewrite 代理缓冲 SSE → 所有实时功能"假 FAIL"。诊断见 $MARK-SSE-blocker-rootcause.md。
2. **修复**: 改用 docker local-test 栈(38190 caddy),build worktree frontend 镜像塞进去。caddy reverse_proxy 不缓冲 SSE → 实时功能恢复。
3. **副问题**: colima 注入宿主代理(192.168.5.2:7897)到所有容器,致容器间通信 502。修法: NO_PROXY override 包含 backend/frontend/db/caddy 服务名。
4. **第二轮(38190 caddy 栈)**: SSE 流式正常(ready 帧立即到达),11 个场景 PASS。

## 核心发现(非待测代码缺陷)
### 1. dev 环境的 Next 代理缓冲 SSE(环境问题,非代码 bug)
- 走 :3000 Next rewrite: events/stream 200 但 0 字节到达
- 走 38190 caddy: ready 帧立即到达
- 影响: dev 模式下所有实时功能测不了;生产(caddy/nginx)无此问题
- 建议: dev 下让 SSE 直连 :8000,或文档化"实时功能在 caddy 栈测"

### 2. 后端 public_events.py 对 DM 用错 scope.kind(后端 bug,非本批次)
- public_events.py:276/287 构造 scope 时 DM 硬编码 kind="channel"(应为 "dm")
- 导致 chat 递增用 chat:channel:*,清除用 chat:dm:*,key 不匹配 → 进 DM 页清不掉未读(S8)
- 不属于前端三连批次,建议另立后端任务

## 待测代码本身:逻辑正确
- SSE 单连接、聊天拆分、TaskBoard 后台刷新(perf 三项)均 PASS
- activity 指示框架(递增/清除/抑制/持久化/迁移)在 SSE 可达时全部 PASS(activity)
- 通知设置 UI + 域开关 + 复用 SSE(notif 可自动化部分)PASS

## 需人工复测
- S10a 自发不计(测试方法歧义,需隔离 currentMemberNames 传入)
- S11 弹窗/S12 抑制/S13 提及/S14 task-memory 通知/S16 节流折叠(浏览器原生通知权限 + 系统通知,需人工授权 + 切后台观察)

## 环境声明: local-dev only
- 38190 caddy 栈(worktree frontend 镜像 + audit backend + 全新 PG)
- 无 local-prod / cloud-prod 声明
- 宿主 :5432 旧库的历史误操作已回滚;未提交任何代码

## 证据文件
- perf: $MARK-S1-sse-single-connection.md, $MARK-S2-S3-38190.md, $MARK-SSE-blocker-rootcause.md(首轮根因), 本文件
- activity: $MARK-S4-chat-badge.md, $MARK-S5-S7.md, $MARK-S8-sidebar-readcursor.md(后端 bug), $MARK-S9-S10.md
- notif: $MARK-S11-S17.md
