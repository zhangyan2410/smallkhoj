# Hook 指南

> 针对 `frontend/hooks/` 中可复用客户端行为与路由局部客户端辅助逻辑的规则。

SmallKhoj 目前直接使用 React/Next 原语。Web 前端没有 React Query、SWR 或 Zustand。因此 hook 应保持小而专用：可复用的浏览器行为放进 hook；服务端数据加载放进 server component/action 或 API 辅助函数。

---

## Hook 逻辑放在哪里

| 逻辑 | 位置 | 示例 |
| --- | --- | --- |
| 可复用的浏览器行为 | `frontend/hooks/use-*.ts` | `use-resizable-panel.ts` |
| 只被一个路由使用的路由局部 context/辅助逻辑 | 与路由同目录，放在 `frontend/app/<route>/` 下 | `app/chat/chat-data-context.tsx` |
| 服务端数据加载 | server component/页面辅助函数或 `lib/control-plane.ts` | `apiGet`、`apiPost` |
| 一次性的 UI 状态 | 客户端组件内的局部 `useState` | 对话框开合状态 |

只有当至少两处界面需要同一段逻辑，或行为复杂到内联会让组件难以阅读时，才把它提升到 `hooks/`。

---

## 必须遵守的模式

### 浏览器全局对象只在挂载后读取

hook 必须是 SSR/hydration 安全的。渲染期间不要读取 `window`、`document`、`localStorage`、布局尺寸或媒体查询。首次渲染使用稳定的默认值，然后在 `useEffect` 中读取浏览器状态。

```tsx
// Correct: first render is deterministic; localStorage is read after mount.
const [stored, setStored] = useState(defaultWidth)

useEffect(() => {
  const raw = window.localStorage.getItem(storageKey)
  setStored(clamp(Number(raw) || defaultWidth))
}, [storageKey, defaultWidth, clamp])
```

### 持久化 UI 偏好必须显式声明

只有长期有效的用户偏好才应存入 `localStorage`，例如面板宽度或主题偏好。使用带命名空间的键，如 `smallkhoj.tasks.listWidth`。不要把 API 数据、任务数据、成员数据或 runtime 事件存进 `localStorage`。

### 指针/键盘行为是 hook 契约（contract）的一部分

当 UI 提供键盘可访问的操作件时，可复用的交互 hook 必须同时暴露指针和键盘处理器。`useResizablePanel` 返回 `onPointerDown` 和 `onKeyDown`；使用它的分隔条必须设置 `role="separator"`、`aria-orientation`、`aria-label` 和 `tabIndex={0}`。

### 高频遥测不进组件状态

滚动/指针进度等逐帧遥测绝不能进入组件根状态。这是 `07-24-chat-transition-fast-path` 中 P0 回归的来源：每个 `scroll` 事件都会重渲染整棵 `ChannelClient` 树和消息列表。

规则（参考实现：`app/(app)/chat/[channel]/message-list.tsx` 中的 `ChatScrollRail`）：

- 把从 DOM 派生的值保存在 ref 里，并直接写回 DOM，作为 `data-*` 属性或 CSS 自定义属性（`rail.dataset.visible = ...`、`tick.dataset.active = ...`）。CSS 消费这些属性；React 看不到这些更新。
- 每个关注点只保留一个经 rAF 合并的订阅：单一的 `onScrollOrResize` 处理器执行 `cancelAnimationFrame(frame); frame = requestAnimationFrame(update)`，`scroll` 监听器以 `{ passive: true }` 注册。
- 禁止双重订阅：不要同时通过 JSX prop（`onScroll={...}`）和 `addEventListener("scroll", ...)` 注册同一关注点——处理器会重复触发，生命周期也会分叉。每个事件只选一个归属。
- observer effect 的依赖数组不得包含 `messages.length`（或任何高频变化的数据）：针对稳定的 ref 订阅一次（`[scrollContainerRef]`），让 ResizeObserver 自己感知内容增长——按每条消息重新订阅会重建监听器，并在每条消息到达时重新触发遥测。（新消息时滚动到底部这类刻意设计的例外是独立的 effect，有自己的契约。）

### hook 不应隐藏路由上下文

如果 hook 需要路由特定的 id 或当前选中项，把它作为参数传入。不要让可复用的 hook 去解析 `window.location` 或假设路由形状。聊天数据这类路由局部 provider 可以使用 `usePathname()`，因为它们与该路由同目录。

---

## 数据获取

SmallKhoj 前端的服务端数据目前经由：

- `frontend/app/**` 中的 server component 和 server action
- `frontend/lib/control-plane.ts` 中的 `apiGet` / `apiPost` / `apiPut` / `apiPatch` / `apiDelete`
- 服务端变更后调用 `revalidatePath()`
- `RealtimeRefresh` 处理 SSE 驱动的路由刷新

不要为一次性页面引入客户端 fetch/缓存库。如果以后采用 React Query 或其他缓存方案，先更新 `state-management.md` 和本文件，保持服务端/客户端职责清晰。

---

## 常见错误

- 在服务端渲染的客户端组件里用 `useState(() => ...)` 读取 `localStorage`，导致 hydration 不匹配。
- 把指针缩放逻辑留在页面内部而不使用 `useResizablePanel`，导致各处实现逐渐漂移。
- 为单个路由的标签/筛选/对话框状态创建全局 store。
- context/hook 的值每次返回新分配的对象且未用 `useMemo` 做记忆化（memoization），造成不必要的子组件重渲染。
