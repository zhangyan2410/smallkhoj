# 组件指南

> SmallKhoj 中组件如何构建与分层。编写或修改任何 UI 前必读。

最重要的一条规则：**绝不在页面/特性代码里硬编码样式。**
组件拥有自己的样式；页面组合（composition）组件并传递数据。正是这一点让一次视觉改动（边框色、圆角、状态色）能够从一处传播到整个应用。

---

## 三层组件模型

每块 UI 必须恰好归入以下某一层。通过问"它需要了解产品数据，还是只关心渲染？"来选择。

```
┌─────────────────────────────────────────────────────────┐
│  Layer 3 — Pages / Features (app/**, feature comps)     │  knows product data
│    compose Layer 1+2, pass data, never style            │  NO hardcoded styles
├─────────────────────────────────────────────────────────┤
│  Layer 2 — Product primitives (components/**)           │  knows product concepts
│    StatusPill, ProductRow, Toolbar, EmptyState,         │  styling allowed
│    ProductShell, TaskListPanel, MessageActions...       │  (referencing Layer 1)
├─────────────────────────────────────────────────────────┤
│  Layer 1 — Atoms (components/ui/**)                     │  knows nothing about product
│    Card, Button, Input, Select, Textarea, Panel,        │  owns base styling
│    Dialog, Avatar, ScrollArea, Tabs, FieldLabel         │  references tokens only
├─────────────────────────────────────────────────────────┤
│  Layer 0 — Tokens & utilities (globals.css :root)       │  the single source of truth
│    --ink, --sand*, --primary, --success*, sk-* classes  │  change here → app follows
└─────────────────────────────────────────────────────────┘
```

### 第 0 层 — 令牌（token，globals.css）

颜色、圆角、阴影只存在于这一层。绝不在组件或页面里写 `oklch(...)`、`#hex` 或
Tailwind 调色板颜色（`bg-emerald-500`、`bg-sky-200` 等）。要引用令牌：
`bg-primary`、`border-[var(--ink)]`、`bg-success`。

### 第 1 层 — 原子组件（Atoms，components/ui/*）

原子组件拥有自己的基础样式，且只引用令牌。它们不得导入产品代码
（`lib/control-plane`、特性组件）。`<Card>` 对任务或成员一无所知——它只渲染
一个带边框的盒子。

`Tabs`（`components/ui/tabs.tsx`）是共享的无障碍标签页原子组件。它负责
`role="tablist"`/`role="tab"`/`role="tabpanel"`、roving 键盘焦点，以及
ink 边框的激活/未激活表面。特性页面提供取值与内容；它们不得手搓第二套
标签页样式，也不得渲染未选中面板里可复制的命令文本。

### 第 2 层 — 产品原语（Product primitives，components/*，不在 ui/ 内）

组合原子组件并引用产品概念（status、runtime）。允许写样式，但必须复用第 1 层
原子组件和第 0 层令牌。示例：`StatusPill` 用 `badgeClass()`（读取状态令牌）
包裹一个 `<span>`——它不重新定义颜色。

### 第 3 层 — 页面与特性（app/**）

组合第 1 + 2 层。**绝不在这一层写样式。** 不要
`className="rounded-md border bg-..."`，不要 `bg-emerald-500`，不要带硬编码
类的本地 `<select>`/`<button>`。如果需要一个带样式的元素，用原子组件；如果
原子组件不存在，就把它加进第 1 层。

---

## 单一来源规则（关键）

对任何视觉关注点，必须恰好存在一个唯一事实来源：

| 关注点 | 唯一来源 | 如何全应用修改 |
|---|---|---|
| 品牌/主色 | `--primary` 令牌 | 编辑 globals.css |
| 边框色（handcraft） | `--ink` 令牌 | 编辑 globals.css |
| 状态色 | `--success/--warning/--info/--danger` + `badgeClass()` | 编辑 globals.css 或 statusKind() 映射 |
| 卡片边框/圆角/阴影 | `Card` 组件 | 编辑 components/ui/card.tsx |
| 按钮变体（variant） | `buttonVariants` cva | 编辑 components/ui/button.tsx |
| 输入框边框/焦点 | `Input` 组件 | 编辑 components/ui/input.tsx |

**如果你发现自己在 3 个以上文件里改同一种样式，说明架构错了**——把它提升为
令牌、工具类或原子组件，然后撤销那些分散的改动，让单一来源驱动它们。

---

## 页面/特性代码中的禁用项

这些就是导致"改一处、什么都不传播"的模式：

- ❌ 带硬编码 Tailwind 类的裸 `<select>`、`<textarea>`、`<input type=text>`。
  改用 `@/components/ui/form` / `input` 里的 `<Select>`、`<Textarea>`、`<Input>`。
- ❌ 裸 `<button className="bg-primary ...">`。改用 `<Button variant size>`。
- ❌ `<div className="rounded-md border bg-background p-3">`（手搓卡片）。
  改用 `<Card>`、`<Card size="sm">` 或 `<Panel>`。
- ❌ 硬编码调色板颜色：`bg-emerald-500`、`text-rose-700`、`border-sky-200`、
  `bg-amber-50`、任何 `oklch()`/`#hex` 字面量。改用状态令牌 / `badgeClass()`。
- ❌ 在页面里本地重定义 `dotClass`/`badgeClass`/`statusLabel`/`StatusBadge`。
  从 `@/lib/control-plane` 和 `@/components/product-ui` 导入。
- ❌ 本地重定义 `Field`、`FieldLabel`、`Select`。导入共享版本。
- ❌ 容器上的 `rounded-lg`/`rounded-xl`/`rounded-md`（handcraft = `rounded-none`）。
  只允许 `rounded-full`，用于小圆点/状态指示器。

### 当裸元素不可避免时

如果原子组件确实无法表达你的需求（例如带 `onChange` 的受控 `<select>`），
保留裸元素，但应用 handcraft 工具类：
`rounded-none border-2 border-[var(--ink)] bg-transparent`。然后提一条扩展
原子组件的备注。绝不要硬编码颜色。

---

## 组合模式

### 通过 cva（class-variance-authority）实现变体

具有多种外观的原子组件使用 `cva`（见 `button.tsx`）。页面选择 `variant`，
绝不覆盖类。新增一个变体 = 编辑一个 cva 映射。

### `className` 透传

每个原子组件都接受 `className` 并通过 `cn()`（tailwind-merge）合并。页面
可以追加布局（layout）工具类（`mb-4`、`w-full`），但不得覆盖原子组件的
标志性样式（边框、圆角、颜色）。`cn()` 保证后写者生效，因此标志性类排在
前面。

### `<Card>` vs `<Panel>` vs 裸 section

- `<Card>` — 主要的有框容器，带 handcraft 边框 + 硬阴影。
- `<Panel variant="default">` — 同样的边框，无阴影（消息气泡、密集信息块）。
- `<Panel variant="raised">` — 边框 + 硬阴影，但框感比 Card 更轻。
- 无边框的裸 `<section>`/`<div>` — 仅用于纯布局容器（网格、flex）。

### 拖拽分层：原生 HTML5 DnD vs dnd-kit（06-19-drag-and-drop）

两套拖拽系统并存是设计使然；按载荷（payload）选择，而不是按偏好：

- **OS 文件拖放和跨表面落放使用原生拖拽事件（event）+
  `DataTransfer`**（`onDragStart`/`onDragOver`/`onDrop`，以及
  `lib/drag-data.ts` 里如 `AGENT_DRAG_MIME` 的自定义 MIME 类型）。dnd-kit 的
  传感器感知不到系统文件，也感知不到在 React 树之外发起的拖拽——文件落在
  `event.dataTransfer.files`（见 chat `channel-client.tsx`），agent 拖到任务
  上的落放以 `dataTransfer.getData(AGENT_DRAG_MIME)` 到达（见
  `task-board.tsx`）。用 `event.dataTransfer.types.includes(AGENT_DRAG_MIME)`
  给处理器加门控，让文件落放和实体落放不会互相触发。
- **dnd-kit 只用于应用内排序**（任务卡片/列重排）。
  不要把它扩展到文件接入或跨页面落放。
- **拖拽状态是乐观的并带回滚**：立即应用重排/分配，失败时恢复之前的
  顺序——失败的落放不得让 UI 停留在已落放状态。而且拖拽可供性不得破坏
  点击选择：既可拖拽又可点击的元素必须继续充当点击目标（`onClick` 不被
  吞掉，没有卡住的拖拽残影）。

**错误**：在 dnd-kit 的 `onDragEnd` 里读 `dataTransfer.files`，或通过添加
dnd-kit 传感器来启动 OS 文件集成。
**正确**：文件/实体用原生 `onDrop` + MIME 门控；排序用 dnd-kit；两种方式
都是乐观更新 + 回滚。

---

## 新增组件——决策树

1. 是纯展示、不含产品知识？→ **第 1 层**（`components/ui/`）。
2. 是用产品语义（status、runtime）包装原子组件？→ **第 2 层**（`components/`）。
3. 只是为某条路由组合既有组件 + 数据？→ **第 3 层**（内联在页面中；若被复用则放 `components/<feature>/`）。

创建新组件之前，先 grep 一个能完成 80% 工作的既有组件。重复组件是样式漂移的
头号原因。

---

## 无障碍

- 交互元素必须有 `focus-visible` 样式（原子组件已提供）。
- 仅图标的按钮需要 `aria-label`。
- 绝不要为了"干净"而移除焦点环；通过令牌为它设定样式。
- 颜色绝不是唯一信号——状态色要配文字标签或图标。

---

## 布局区域钩子（`data-region`）

**为什么：** 当评审者说"输入框左边的那个盒子"，或在截图上圈出一个位置时，
必须存在一条从屏幕像素 → DOM → 源码的确定性路径。没有它，agent 只能按
类名字符串去猜，并且频繁指错元素。

**规则：** 多面板页面的每个命名区域必须在其最外层容器上携带稳定的
`data-region="<kebab-case-name>"`。"命名区域"指任何一个人会用手指过去的
面板/栏/区域：侧栏、消息列表、输入区、线程（thread）面板、成员面板、顶栏、
详情窗格等。纯布局的包装层（网格、flex 父容器）不需要——只需要用户会当作
一个单元来识别的区域。

约定：
- 取值是**语义化且稳定的**：`data-region="composer"`，而不是
  `data-region="bottom-input-thing"`。样式变化时它不得改变。
- 它位于拥有该区域背景/边框的**同一个元素**上，这样检查区域时也能看到它的
  容器样式。
- `data-testid` 用于测试选择器（可以冗长/具体）；
  `data-region` 用于**人↔代码定位**并保持粗粒度。
- 区域内的原子组件不重复区域名——它们保留自己的
  `data-slot`（例如 `data-slot="member-avatar"`）。

当前区域（chat）：`chat-main`、`message-list`、`composer`、
`thread-panel`、`members-panel`。改到其他多面板路由（任务看板、control、
daemon）时添加等价物。

**验证：** `[data-region]` 必须能从浏览器查询到。测试 SOP 应断言每个命名
区域存在且可见，而不是依赖脆弱的类名匹配。

### 墨框（Inkframe）表面属性是测试契约（contract）（07-06-browserless-dom）

`data-inkframe-*` 词汇表是组件、组件测试（`test/material-surface.test.tsx`）
与证明运行器（`tools/twd-guard/twd-inkframe-proof.mjs`）之间的契约层。每个
物质表面暴露的核心属性：

- `data-inkframe-surface`（`"material"` | `"app-background"`）
- `data-inkframe-owner-kind` / `data-inkframe-owner-id`（谁拥有该表面：
  `"app-background"`/`"global-desk"`、`"message"`/`<msg-id>`、
  `"task"`/`<task-id>`）
- `data-inkframe-region`（工作区区域：`app-background`、`chat-main`、
  `task-main` 等）
- `data-inkframe-tint`（`desk` | `paper` | `task` | `evidence` | `review`）
- `data-inkframe-mobile-role`（`sidebar-drawer`、`sidebar-drawer-toggle`、
  `sidebar-drawer-close`、`task-detail`、`chat-message-list` 等）
- `data-inkframe-state`（显式的折叠/展开等状态，例如移动端列表抽屉），以及
  扩展家族（`data-inkframe-unread`、`data-inkframe-pointer-capture`、
  `data-inkframe-contrast-owner`、`data-inkframe-foreground-surface`）。

规则：

- 不暴露这些属性的新表面就是未完成——选择器驱动的证明运行器看不见它，
  无浏览器 DOM 测试也无法断言它。属性值是稳定的契约字符串；改动其中一个
  就是对 `twd-inkframe-proof` 分组的破坏性变更。
- 断言走这些选择器，而不是截图：DOM 属性是确定性且可 diff 的；像素比较不是。
  截图证据是给人审阅视觉样式用的，绝不作为通过/失败门禁。

---

## 常见错误（本代码库中观察到）

1. **每页各自重定义 StatusBadge/dotClass** → 导致 4 种不同的"done"颜色。
   已修复：单一来源在 `lib/control-plane.ts`。不要再犯。
2. **到处手搓 `rounded-md border bg-background p-3`** → 无法全局修改卡片
   样式。已修复：`<Card>`/`<Panel>`。不要再犯。
3. **为状态硬编码 emerald/amber/sky/rose** → 绕过了主题。已修复：状态
   令牌。任何新的状态 UI 必须使用 `badgeClass()`/`dotClass()`/`StatusPill`。
4. **图标栏的两份拷贝**（ProductShell + channel-client）→ 样式漂移。
   规则：**一个栏，放在 `app/(app)/layout.tsx`**（`AppRail` 组件）。Chat 必须
   组合它，而不是重建它。（历史上该栏位于 `ProductShell` 内部，但
   `07-24-chat-transition-fast-path` 的 P2 把它提升进了共享的 `(app)` 布局，
   让外壳 chrome 在路由切换之间保持存在，而不是每页重建。
   `ProductShell` 现在只剩主体——页眉 + 三栏主体——并且不挂载栏、
   `AppDeskBackground` 或 `InkMaterialRuntimeScript`。）
5. **布局面板没有 `data-region`** → 截图或"输入框左边的那个盒子"无法映射
   回源码；agent 反复指错元素。已修复：chat 的区域现在带 `data-region`。
   不要新增不带区域标记的多面板页面（见上文布局区域钩子）。
6. **未测量就把切换卡顿归咎于 WebGL 墨水背景**
   （任务 `07-24-chat-transition-fast-path`）→ 一份初始诊断声称
   "每次路由切换时的 WebGL 重新初始化是主要开销"。这是**错的**：
   `AppDeskBackground` 和 chat 桌面 `MaterialSurface` 都默认
   `mode="static"`，在该模式下不挂载任何 `<canvas>`，表面效果在任何 GL 调用
   之前就提前返回；激活事件 `APP_DESK_MATERIAL_EVENT` 在前端**零个派发点**，
   chat 桌面只通过显式按钮点击激活。**路由切换路径上的 WebGL 开销恰好为
   零。** 在把某个渲染器/初始化点名为性能根因之前，先用 profile 或渲染计数
   探针证明——不要从"树里有个 canvas 组件"推断结论。
