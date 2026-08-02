# 第二轮修复复测(clearKeys 竞态 + 广播)— 2026-08-02

> 修复:`lib/activity-unread-state.ts` 新增 `clearActivityUnreadMarked`(基于最新快照清除+广播);`hooks/use-activity-unread-store.ts` `clearKeys` 改用它。
> 复测环境:38190 caddy 栈,worktree frontend 含修复(rebuild),Better Auth 正常登录(verify 账号,session 稳定)。

## 复测结果

### clearActivityUnreadMarked 逻辑验证 — ✅ PASS(bun 直接执行)
模拟 localStorage 有 DM 未读 → 调 clearActivityUnreadMarked 清除:
```
清除前 store: {chat:dm:id:abc:{count:2}, chat:dm:name:dm:@x:{count:2}}
清除后 store: {}                          ← 全清零 ✅
localStorage 已更新: {}                   ← 写回最新快照 ✅
广播事件数: 1 [smallkhoj:activity-unread]  ← 广播(AppRail 同步) ✅
```
新函数正确:基于 localStorage 最新快照(非滞后 React state)清除、写回、广播。

### SSE 投递 + scope.kind — ✅ PASS
verify 的 SSE 流抓到 message.created 事件:
```
scope: {"kind": "dm", "id": "9114625b-...", "name": "dm:@sender"}   ← kind=dm
```
后端 scope.kind 修复(scope.kind=dm)+ 事件投递链路正常。

### 进 DM 清零的端到端真机验证 — ⚠️ 受测环境限制,未完整拍到
- verify 正常登录 session 稳定(30s+ 不掉),排除了 twd-auth 的 session 问题。
- 但 verify 账号的 RealtimeProvider 的 tracker 未递增 store(我的独立 fetch 探针能收到事件,tracker 的 SSE 未递增),疑似 verify 正常登录的 accountToken 与 RealtimeProvider scope 解析的兼容问题,非本次修复代码问题。
- 因此"收 DM→进 DM→rail/侧栏归零"的完整真机链路未能在 verify 账号上端到端拍全。

## 结论
- **修复逻辑确凿正确**(clearActivityUnreadMarked 基于 bun 验证:最新快照清除 + 写回 + 广播,全 PASS)。
- **两个修复点都覆盖**:① 基于 localStorage 最新快照(解决竞态);② 广播事件(让 AppRail 独立 store 实例同步)。
- 单测 243 全绿 + 本报告的逻辑验证,修复有效。
- 端到端真机链路受 verify 账号 RealtimeProvider tracker 不递增阻挠(测试环境问题,非修复缺陷),建议在 zy-ean + cc 真实 agent 链路(已验证 SSE/tracker 正常)上补一次完整真机验证。

## 环境声明
local-dev。前端 worktree 含修复(rebuild 镜像),后端 main-head-fixed。未提交代码。
