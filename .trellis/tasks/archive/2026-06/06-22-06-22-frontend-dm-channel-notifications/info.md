# 交接说明 — DM/Channel 未读通知 + 活跃 Agent 面板

## 启动命令

```bash
cd /Users/code/project/smallkhoj
python .trellis/scripts/task.py start 06-22-06-22-frontend-dm-channel-notifications
```

## 依赖（已完成）

- `lib/agent-status.ts` — 桶映射 + `getStatusLabel()` ✅
- `globals.css` — `--agent-color-1..6` 颜色变量 ✅

## 核心文件

- `frontend/app/chat/[channel]/channel-client.tsx` — 所有改动在这里

## 实现要点

### 1. 客户端未读计数

在 `ChannelClient` 组件顶部加：
```tsx
const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
```

在 realtime event handler 里，当收到 `message.created` 且 `event.channelId !== channelId`：
```tsx
setUnreadCounts(prev => ({ ...prev, [event.channelId]: (prev[event.channelId] ?? 0) + 1 }))
```

导航到某频道时清零：
```tsx
setUnreadCounts(prev => { const next = { ...prev }; delete next[channelId]; return next })
```

### 2. DM 列表项（有未读时）

在 DM 列表渲染处，当 `unreadCounts[dm.id] > 0`：
- DM 名字加 `font-semibold`
- 右侧加红色角标：`<span className="ml-auto rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] text-white">{count}</span>`

### 3. Channel 列表项（低密度）

当 `unreadCounts[ch.id] > 0`，名字右侧加一个小圆点：
`<span className="size-1.5 rounded-full bg-primary" />`

### 4. 活跃 Agent 面板

在侧边栏 DM 列表底部加一个区块，显示所有 `status` 桶为 ACTIVE/THINKING/STARTING 的 agent：
- 从 `allMembers.filter(m => m.kind === "agent" && ["ACTIVE","THINKING","STARTING"].includes(getStatusBucket(m.status)))`
- 每行：`MemberAvatar` size="xs" + 名字 + `getStatusLabel(m.status)`
- 用 `agent-status.ts` 的导出，不要重新写逻辑

## 验收

- `npm run lint` + `npx tsc --noEmit` 通过
- DM 收到 agent 回复 → 角标出现，点进去消失
- Channel 有新消息 → 仅小圆点，无数字
- 有活跃 agent 时侧边栏底部面板可见
