# 交接说明 — 主页 Dashboard 工作台

## 启动命令

```bash
cd /Users/code/project/smallkhoj
python .trellis/scripts/task.py start 06-22-06-22-frontend-home-dashboard
```

## 依赖（已完成）

- `globals.css` — `--gradient-brand`、深色主题 ✅
- `lib/agent-status.ts` — `getStatusBucket()` + `getStatusLabel()` ✅

## 核心文件

- `frontend/app/page.tsx` — 主要改动在这里（当前是搜索页 + 频道列表）

## 目标布局

```
[品牌标题（渐变文字）]  你好，{用户名}

┌───────────────┐  ┌──────────────┐  ┌──────────────┐
│  近期消息       │  │  运行中智能体  │  │  待处理任务   │
│               │  │              │  │              │
│  [频道] 发件人  │  │ 头像 名字     │  │ N 个进行中    │
│  消息预览...    │  │ 头像 名字     │  │ N 个待处理    │
│  10分钟前       │  │ 头像 名字     │  │              │
└───────────────┘  └──────────────┘  └──────────────┘
```

## 实现要点

### 品牌标题

```tsx
<h1 className="bg-gradient-brand bg-clip-text text-4xl font-bold text-transparent">
  SmallKhoj
</h1>
<p className="mt-1 text-muted-foreground">你好，{session?.account?.displayName} 👋</p>
```

注意：`bg-gradient-brand` 是 `globals.css` 里已定义的 utility class。

### 活跃 Agent 面板

从 members API 拿数据，过滤 `getStatusBucket(m.status)` 在 ACTIVE/THINKING/STARTING 的：
```tsx
const activeAgents = members.filter(m =>
  m.kind === "agent" && ["ACTIVE","THINKING","STARTING"].includes(getStatusBucket(m.status))
)
```

### 近期消息

目前 `app/page.tsx` 已经有获取 activity 和 channels 的逻辑，可以复用。  
取最近10条 activity 里 type 为 `message_sent` 的，展示频道名 + 消息预览。

### 待处理任务

取 tasks API，统计 `status === "open"` 和 `status === "in_progress"` 的数量。

### RealtimeRefresh

加：
```tsx
<RealtimeRefresh eventTypes={["member.status.updated", "message.created", "task.updated"]} />
```

## 验收

- `npm run lint` + `npx tsc --noEmit` 通过
- 主页展示三列面板
- 品牌标题有渐变色
- 活跃 agent 实时更新
