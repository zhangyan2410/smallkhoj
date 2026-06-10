# khoj 前端设计规范

从 khoj GitHub 源码提取的完整设计规范，供构建 SmallKhoj 前端视觉 demo 参考。

---

## 1. 技术栈

- **框架**: Next.js + React
- **样式**: Tailwind CSS + CSS Modules（混用）
- **组件库**: shadcn/ui
- **图标**: @phosphor-icons/react
- **字体**: Noto Sans（含 Arabic 变体）
- **动画**: tailwindcss-animate 插件

---

## 2. 色彩体系（HSL CSS Variables）

### Light Theme

| Token | HSL | 近似色值 |
|-------|-----|---------|
| --background | 0 0% 100% | #ffffff |
| --foreground | 224 71.4% 4.1% | #0a0e1a |
| --primary | 24.6 95% 53.1% | #ff6b35 (橙色) |
| --primary-foreground | 0 0% 98% | #fafafa |
| --secondary | 220 14.3% 95.9% | #f1f3f7 |
| --secondary-foreground | 220.9 39.3% 11% | #1a1e2e |
| --muted | 220 14.3% 95.9% | #f1f3f7 |
| --muted-foreground | 220 8.9% 46.1% | #6b7394 |
| --accent | 220 14.3% 95.9% | #f1f3f7 |
| --accent-foreground | 220.9 39.3% 11% | #1a1e2e |
| --destructive | 0 84.2% 60.2% | #e5484d |
| --border | 220 13% 91% | #e2e5eb |
| --input | 220 13% 91% | #e2e5eb |
| --ring | 24.6 95% 53.1% | #ff6b35 |
| --radius | 0.5rem | — |

### Dark Theme

| Token | HSL | 近似色值 |
|-------|-----|---------|
| --background | 0 0% 14% | #242424 |
| --foreground | 210 20% 98% | #f8fafc |
| --primary | 20.5 90.2% 48.2% | #ed6a2e |
| --primary-foreground | 60 9.1% 97.8% | #f8f6f0 |
| --secondary | 0 0% 15% | #262626 |
| --secondary-foreground | 210 20% 98% | #f8fafc |
| --muted | 0 0% 15% | #262626 |
| --muted-foreground | 220 8.9% 46.1% | #6b7394 |
| --accent | 0 0% 15% | #262626 |
| --accent-foreground | 210 20% 98% | #f8fafc |
| --destructive | 0 62.8% 30.6% | #4d1c1e |
| --border | 0 0% 20% | #333333 |
| --input | 0 0% 20% | #333333 |
| --ring | 20.5 90.2% 48.2% | #ed6a2e |

### 侧边栏

| Token | Light HSL | Dark HSL |
|-------|-----------|----------|
| --sidebar-background | 0 0% 98% | 240 5.9% 10% |
| --sidebar-foreground | 240 5.3% 26.1% | 240 4.8% 95.9% |
| --sidebar-primary | 240 5.9% 10% | 224.3 76.3% 48% |
| --sidebar-primary-foreground | 0 0% 98% | 0 0% 100% |
| --sidebar-accent | 240 4.8% 95.9% | 240 3.7% 15.9% |
| --sidebar-accent-foreground | 240 5.9% 10% | 240 4.8% 95.9% |
| --sidebar-border | 220 13% 91% | 240 3.7% 15.9% |
| --sidebar-ring | 217.2 91.2% 59.8% | 224.3 76.3% 48% |

---

## 3. 侧边栏（Sidebar）

- **宽度**: 桌面 `18rem` / 移动端 `20rem`
- **使用**: shadcn `SidebarProvider` + `SidebarInset` + `SidebarTrigger`
- **导航项**: Home(`/`), Agents(`/agents`), Automations(`/automations`), Search(`/search`), Settings(`/settings`)
- **图标**: @phosphor-icons/react — Plus, Gear, HouseSimple 等
- **结构**: SidebarHeader（Logo + New按钮）→ SidebarContent（导航 + 聊天历史）→ SidebarFooter
- **聊天历史**: AllConversations 组件，按时间分组显示历史会话
- **New 按钮**: 侧边栏头部，创建新聊天会话

---

## 4. 聊天布局（Chat Layout）

### 整体结构

```
┌──────────────────────────────────────┐
│  Sidebar  │  Main Content Area       │
│  (18rem)  │                          │
│           │  ┌──────────────────┐    │
│  Nav      │  │  Chat Messages   │    │
│  History  │  │  (scroll area)   │    │
│           │  └──────────────────┘    │
│           │  ┌──────────────────┐    │
│           │  │  Input Box       │    │
│           │  │  + Send Button   │    │
│           │  └──────────────────┘    │
└──────────────────────────────────────┘
```

### Chat Body Grid

- **桌面**: `grid-template-columns: 1fr 1fr`（两栏，右侧可选 agent 面板）
- **移动**: `grid-template-columns: 0fr 1fr`（隐藏侧面板）
- **Chat 消息区**: `grid-template-columns: 1fr`, `gap: 1rem`

### 输入框

- 边框: `1px solid var(--border-color)`
- 聚焦阴影: `0px 8px 16px rgba(0,0,0,0.2)`
- 发送按钮: 渐变背景 `linear-gradient(var(--calm-green), var(--calm-blue))`

---

## 5. 消息气泡（Message Bubbles）

### 用户消息

- `background-color: hsla(var(--secondary))`
- `align-self: flex-end`（右对齐）
- `border-radius: 16px`
- `padding: 8px 16px 0 16px`

### AI (Agent) 消息

- `background-color: transparent`（无背景）
- `align-self: flex-start`（左对齐）
- `border-radius: 16px`
- `padding: 8px 16px 0 16px`

### 其他细节

- **消息容器**: `margin: 12px`
- **作者标签**: `font-size: 0.75rem`, `color: #808080`
- **消息内图片**: `height: 128px`, `border-radius: 8px`, `object-fit: cover`
- **底部操作按钮**: `border-radius: 16px`, `border: var(--border-color) 1px solid`

---

## 6. 动画

```css
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes fadeInRight {
  from { opacity: 0; transform: translateX(-10px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes fadeInLeft {
  from { opacity: 0; transform: translateX(10px); }
  to { opacity: 1; transform: translateX(0); }
}
/* 持续时间: 0.3s ease-out */
```

---

## 7. 圆角体系

基于 `--radius: 0.5rem`:

| 级别 | 计算 | 实际值 |
|------|------|--------|
| lg | var(--radius) | 8px |
| md | calc(var(--radius) - 2px) | 6px |
| sm | calc(var(--radius) - 4px) | 4px |
| 消息气泡 | 固定 | 16px |
| 侧边栏按钮 | 固定 | 16px |

---

## 8. 关键组件模式

- **Sidebar**: shadcn SidebarProvider 嵌套模式，SidebarInset 包裹主内容
- **WebSocket 实时消息**: 使用 `react-use-websocket` 库
- **空闲超时**: 10 分钟无操作
- **认证**: `useAuthenticatedData()` hook
- **ChatSidebar**: 独立于 AppSidebar 的聊天专用侧边栏
- **Tailwind Container**: `center: true`, `padding: 2rem`, `max-width: 1400px` (2xl)

---

## 9. 核心视觉特征总结

1. **主色**: 橙色 (#ff6b35) — 用于 primary 按钮、焦点环、链接
2. **布局**: 左侧固定侧边栏 18rem + 右侧弹性内容区
3. **聊天**: 用户消息带灰色背景右对齐，AI 消息透明左对齐
4. **圆角**: 大量使用 16px 圆角（消息、按钮），整体偏圆润
5. **暗色模式**: 完整的 dark theme token 体系
6. **字体**: Noto Sans，跨语言友好
7. **图标**: Phosphor Icons 风格（线条图标）
8. **间距**: gap 1rem, padding 16px, margin 12px 为主
