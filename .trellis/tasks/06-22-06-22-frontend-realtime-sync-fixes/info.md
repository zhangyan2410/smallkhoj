# 交接说明 — Realtime Sync Fixes

## 启动命令

```bash
cd /Users/code/project/smallkhoj
python .trellis/scripts/task.py start 06-22-06-22-frontend-realtime-sync-fixes
```

## 背景

此任务独立，无依赖，最简单先做。

前任 Claude agent 已完成：主题系统、状态系统、消息颜色条纹。
这个任务只需修三处实时同步问题。

## 核心文件

- `frontend/app/members/page.tsx` — `RealtimeRefresh` 缺少 `"member.created"` 事件
- `frontend/lib/realtime-events.ts` — 检查 SSE 是否有重连逻辑

## 实现要点

### 1. Members 页加事件（最简单）

在 `members/page.tsx` 找到：
```tsx
<RealtimeRefresh eventTypes={["member.updated", "member.status.updated"]} />
```
改为：
```tsx
<RealtimeRefresh eventTypes={["member.updated", "member.status.updated", "member.created"]} />
```

### 2. 检查 SSE 重连

读 `lib/realtime-events.ts` 的 `connectRealtimeEvents`，
如果没有断线重连，加 exponential backoff（最大30s）。

## 验收

- `npm run lint` + `npx tsc --noEmit` 通过
- 新建 agent 后成员列表自动出现（无需刷新）
