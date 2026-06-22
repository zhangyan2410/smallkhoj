# 交接说明 — Members 页卡片画廊改版

## 启动命令

```bash
cd /Users/code/project/smallkhoj
python .trellis/scripts/task.py start 06-22-06-22-frontend-members-page-redesign
```

## 依赖（已完成）

- `globals.css` — 深色主题、渐变变量、`--agent-color-1..6` ✅
- `lib/agent-status.ts` — `getStatusBucket()` + `getStatusLabel()` ✅
- `components/member-avatar.tsx` — 状态动画 ✅

## 核心文件

- `frontend/app/members/page.tsx` — 主要改动在这里

## 当前布局问题

现在是：顶部统计卡片 → 创建表单 → 成员列表（行式）→ 点击展开详情。  
看起来像后台管理系统，不像产品页。

## 目标布局

```
[页面头部：标题]
[Agents (N个)]
 ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
 │ 头像 │ │ 头像 │ │ 头像 │ │  +   │  ← 最后一张是「新建」卡片
 │ 名字 │ │ 名字 │ │ 名字 │ │      │
 │ 状态 │ │ 状态 │ │ 状态 │ │      │
 │操作按钮│ │操作按钮│ │操作按钮│ │      │
 └──────┘ └──────┘ └──────┘ └──────┘
[Humans (N个)]
 ─ 头像  名字  handle  ─
 ─ 头像  名字  handle  ─
```

## Agent 卡片实现

```tsx
function AgentCard({ member, computers }: { member: Member; computers: Computer[] }) {
  return (
    <div className="group relative flex flex-col items-center gap-3 rounded-xl border bg-card p-4 ring-1 ring-primary/10 transition-all hover:ring-primary/30 hover:scale-[1.02]">
      <MemberAvatar member={member} size="xl" showStatus />
      <div className="text-center">
        <div className="font-semibold">{profileName(member)}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{getStatusLabel(member.status)}</div>
      </div>
      {/* start/stop/restart 按钮 */}
      <AgentControls member={member} />
    </div>
  )
}
```

## 控制按钮

需要检查后端 API 是否有 `/api/v1/members/:id/start` 等端点。  
先读 `lib/control-plane.ts` 看有没有已有的控制 API 函数。  
如果没有，添加 server action 调用 `PATCH /api/v1/members/:id` 或 `POST /api/v1/members/:id/restart`。

## 删除顶部统计卡片

把 Total / Humans / Agents Bound 三张卡片去掉，改为 section heading 里的计数文字。

## 验收

- `npm run lint` + `npx tsc --noEmit` 通过
- Agent 以卡片网格显示，有头像+状态动画
- Human 以紧凑列表显示
- 新建 agent 入口在卡片网格末尾
