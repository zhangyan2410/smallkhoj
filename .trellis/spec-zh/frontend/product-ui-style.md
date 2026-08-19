# 产品 UI 风格（Product UI Style）

> SmallKhoj 前端视觉识别：**干宣纸物件书桌（desk）**（墨框（Inkframe）语言）。2026-08 修订以匹配已交付代码（`globals.css`、`theme-switcher.tsx`、`app-rail.tsx`）与已完成的 `06-30-ink-wash-theme-exploration` 决策。当本文件与 `DESIGN.md` 不一致时，以本文件为准；请更新 `DESIGN.md` 与之保持一致。当本文件与代码不一致时，先检查代码——要么该代码是 §已知债务 中列出的债务，要么本 spec 有误，必须在同一个 PR 中修复。

---

## 视觉识别

SmallKhoj 看起来是一张**明亮的工作书桌**，有三种标志性材质（material）：

1. **干宣纸（书桌）** — `--paper` `#f6f1e2`，带隐约的纤维/网格 `--desk-paper-bg`。带矿物质底色的暖调米白；绝不要纯白，绝不要粉红，绝不要整页湿墨晕染。
2. **暖烟墨（结构）** — `--ink` `oklch(0.205 0.028 78)`。所有文本与所有 2px 硬边框共用这一墨色（ink）。直角、错位硬阴影。这是"手工所制、而非模板套出"的信号，与 Croodles 头像描边相统一。
3. **朱砂印（克制的强调色（accent））** — `--cinnabar` `oklch(0.50 0.17 32)`。保留给印章、评审戳与关键强调。绝不用作页面色偏（tint）。

产品表面（surface）分为三层，每层自由度不同：

| 层 | 内容 | 自由度 |
|---|---|---|
| 书桌环境 | 全局背景（`--desk-paper-bg`） | 无 — 干净、明亮、无状态色、无湿墨 |
| 工作纸面 | shell、列表列、主区域、侧栏（`--sheet-paper-bg`） | 仅轻微的纸面（paper）深度；方正而稳定 |
| 手作物件 | 消息、证据、评审戳、任务票、附件、运行时材质 | 个性在这里：短纸条可倾斜、印章有动作、悬停可抬起一张纸 |

### 这替代了什么

- 2026-06 的"水中阳光 + 沙"方向（以中海蓝为先的光效加光晕）已被**取代**；`--primary` 仅在主按钮/链接/焦点上保留克制的中海蓝作为传统品牌强调色。
- 水纹理图标栏（`rail-water-texture.png`）已**移除**。图标栏现在是纸装订脊（`.sk-rail-bg`：`--sand-deep`/`--paper` 混合、墨色边缘、缝线）。应用 chrome 中任何地方都没有水的意象。
- 旧的"未来 `.theme-ink` / `localStorage.theme='ink'`"契约（contract）从未交付，已作废；真正的主题契约在下面。

---

## 主题系统（实际实现）

`components/theme-switcher.tsx` 提供三种主题，经 `localStorage.theme` 持久化：

| 主题 | `<html>` class | localStorage | 特征 |
|---|---|---|---|
| `water`（默认） | 无 | `null`（键被移除） | 默认书桌：干纸 + 墨色 + 完整 B/C 六色强调色系统 |
| `dark` | `.dark` | `"dark"` | 蓝灰深色（不是纯黑）；品牌色相 215 提亮一档 |
| `shuimo`（水墨） | `.shuimo` | `"shuimo"` | 明亮生宣纸 + 暖烟墨 + 朱砂；强调色保持低彩度"墨中透色"的可读性（靛蓝 255 / 黛紫 290 / 朱砂 32 / 苔绿 150 / 琥珀 74） |

规则：

- SSR 快照（snapshot）始终是 `water`；hydration 安全的切换使用 `useSyncExternalStore`。不要在 effect 中添加主题读取。
- 命名债务已被承认：默认主题因历史原因叫 `water`，而其内容是纸面书桌。改名是兼容性变更（切换器 + 存储迁移 + 设置文案）——要么完整做，要么不做。
- `.shuimo` 必须保持强调色色相**可区分**（"墨中透色"规则）。曾尝试把六个强调色全部压成纯墨色后被回退；不要重新引入。

---

## 边框语言（手工墨边框）

已对照 `components/ui/{card,button,input,dialog}.tsx` 验证——这是当前代码，不是愿景。

| 元素 | 边框 | 圆角 | 阴影 |
|---|---|---|---|
| 卡片 / 对话框 / 模态面板 | `2px solid var(--ink)` | `0`（直角） | `2px 2px 0 var(--ink)` 硬错位（`sk-hard-shadow`） |
| 信息块 / 消息气泡 | `2px solid var(--ink)` | `0` | 无（`.sk-panel`） |
| 按钮 | `2px solid var(--ink)` | `0` | 无；悬停加硬阴影 / 1px 抬升 |
| 输入框 / 下拉选择 / 文本域 | `2px solid var(--ink)` | `0` | `focus` 边框 → `--ring` |
| 状态胶囊 | `1px solid var(--ink)` | `0` | 无；填充状态色背景 |
| 小圆点 / 状态指示 | — | `rounded-full`（允许） | 无 |

**原则**：
- 除微小圆点外一律直角。旋转是手工摆放微物件（短聊天纸条、印章、胶带）的局部属性——绝不是纸面的属性。
- 硬阴影只有错位（无模糊）——是"剪纸"，不是"悬浮玻璃"。
- `--radius: 0.875rem` 留在 `:root` 中仅作为 shadcn 兼容残留。产品原子是 `rounded-none`；新代码不得用 `--radius` 构建圆角容器。

### 禁止的边框/阴影模式
- 在容器上使用 `rounded-lg` / `rounded-xl` / `rounded-md`（用 `rounded-none`）。
- `shadow-sm` / `shadow-md` / `shadow-lg` / `shadow-xl`（软 SaaS 阴影）。
- `border + shadow-sm` 组合（幽灵卡片）。
- `backdrop-blur` 装饰玻璃。
- `bg-clip-text` 渐变文字。

---

## 颜色 — 单一事实来源

所有颜色都是 `globals.css` 中的 token。绝不在组件或页面里硬编码颜色。

### 核心表面 token

| 角色 | Token | 当前值 | 说明 |
|---|---|---|---|
| 纸面 / 页面背景 | `--paper`, `--background` | `#f6f1e2` | 宣纸 |
| 冷纸场地 | `--paper-cool`, `--sand` | `#f1efe8` | 列表列 / 主场地 |
| 纸面阴影 | `--paper-deep`, `--sand-deep` | `#e2dac7` | 侧栏 / 深度 |
| 墨色文本 + 边框 | `--ink`, `--foreground`, `--paper-ink`, `--sand-ink` | `oklch(0.205 0.028 78)` | 暖烟墨 |
| 弱化墨色文本 | `--sand-muted` | `oklch(0.43 0.026 78)` | 纸面上 ≥4.5:1 |
| 品牌强调色（传统、克制） | `--primary` | `oklch(0.62 0.13 215)` | 主按钮、链接、焦点 |
| 印章强调色 | `--cinnabar` | `oklch(0.50 0.17 32)` | 仅印章/关键 |
| 材质强调色 | `--moss`, `--amber` | `oklch(0.48 0.088 150)`, `oklch(0.66 0.12 74)` | 克制的材质/状态 |
| 书桌背景 | `--desk-paper-bg`, `--sheet-paper-bg`, `--slip-paper-bg` | 复合渐变 | shell 表面必须使用这些 |

### 状态色

`--success` / `--warning` / `--info` / `--danger`（加 `-fg` 配对）。它们只经 `badgeClass()` / `dotClass()` / `StatusPill` 流转。单一来源规则见 `component-guidelines.md`。

### 分类色

`--cat-info/success/warning/danger/neutral`（+ `-fg`）用于分类标签（RuntimeChip 等）：浅色偏 + 深色文本 + 墨色边缘。分类 ≠ 状态。

### 强调色系统（B/C 双色调）

功能/分区颜色使用**双色调**系统。每个色相有两个变体：

- **solid**（C）——高饱和度，配浅色文本。激活标签页、激活导航刻度、选中项、主 chip。
- **soft**（B）——低饱和度色偏，配深色文本。未激活标签页、分区背景、计数徽标（badge）、角色标签。

工具类 `.sk-accent-<hue>{,-soft}`、`.text-accent-<hue>`、`.border-accent-<hue>` 位于 `@layer components` 设计系统块中，在必须覆盖原子默认值处带 `!important`——Tailwind 层之外的普通选择器可能被编译样式表省略。

| 色相 | solid（浅色） | soft（浅色） | 语义用途 |
|---|---|---|---|
| blue | `oklch(0.52 0.15 251)` | `oklch(0.78 0.11 241)` | 聊天、搜索、链接 |
| rose | `oklch(0.58 0.21 26)` | `oklch(0.80 0.11 3)` | 任务、安全、已保存 |
| mint | `oklch(0.56 0.15 166)` | `oklch(0.80 0.10 166)` | 成员、活动 |
| green | `oklch(0.62 0.18 148)` | `oklch(0.86 0.10 148)` | 计算机、文件 |
| purple | `oklch(0.50 0.15 299)` | `oklch(0.78 0.09 269)` | 控制 |
| yellow | `oklch(0.83 0.17 89)` | `oklch(0.90 0.10 90)` | 仅强调色（无金色/琥珀分区色） |

功能分配（导航色 = 功能色）：
- **图标栏刻度**：search/chat=blue、tasks=rose、members=mint、computers=green、control=purple、activity=mint（`sk-rail-active-<accent>`）。
- **聊天标签页**：chat=blue、tasks=rose、memory=mint、files=green、activity=purple。
- **聊天侧栏分区**：关注=rose、频道=blue、私信=mint、运行中=purple。

规则：
- 不要在同一角色上混用 `sk-cat-*`（分类）与 `sk-accent-*`（功能）。
- 黄色只作强调色；绝不做分区/导航色。无琥珀/金。
- 要重着色应用，只改 `--accent-*` token。

### 紫色规则，修正版

旧的"色相 250-265 的紫色禁止"规则描述的是**被否决的紫蓝渐变品牌主题**，作为一刀切禁令已不再准确。当前规则：

- **禁止**：紫蓝作为*品牌识别*——渐变、玻璃、光晕，或以色相 250-265 的罩色作为页面/表面识别（旧被否决主题）。
- **允许**：紫色作为上文 B/C 系统中的*功能强调色*（控制表面，色相 299 solid / 269 soft），以及 `.shuimo` 中可读的黛紫。
- **仍然禁止**：紫色出现在 **agent 身份色板（palette）** 中（`--agent-color-1..6` 落在海洋系色相 155-230 加珊瑚 25，外加一个色相 75 的暖沙铜例外——`--agent-color-5`，见 `globals.css` 的 `:root` 块；没有任何一个进入已退役的 250-265 紫色带，头像识别因此不会与退役品牌冲突）。色板校验必须接受色相 75 这个例外：拒绝它就会否掉已上线的色板。
- 色相 251 的 `--accent-blue` 处于旧禁止带边缘，但是被接受的功能强调色；让它与 `--primary`（215）保持清晰区分，品牌与功能绝不被读作同一颜色。

### 禁止的颜色
- 紫蓝作为品牌识别或渐变（见上文）。
- Tailwind 色板字面量：`bg-emerald-500`、`bg-amber-50`、`text-sky-700`、`border-rose-200` 等。用 token。
- `bg-white` 作为表面（相对纸面太冷）。用 `--sand-card`/`--paper`。
- 纯 `#000` 文本——墨色是唯一的近黑。

---

## 物件语言

书桌上布满物件隐喻；组件映射到可触摸的书桌物件，而不是泛用卡片。完整分类法、对齐语法（锚 / 主 / 元 / 状态 / 动作 / 证据槽）与页面物件矩阵位于 `.trellis/tasks/archive/2026-07/06-30-ink-wash-theme-exploration/design.md`——把它当作本 spec 的物件语言附录。

核心映射：

- 聊天消息 = 纸条（`MessagePaper`）；短纸条可倾斜，长纸条保持方正
- 消息动作 = 聚在消息旁的小书桌工具，不被推到行边缘
- 任务 = 任务票（`TaskMaterialSurface`）；证据 = 附上的证明纸（`EvidenceSurface`）
- 评审 = 朱砂印章（`ReviewStamp`）；记忆 = 固定便签（`MemoryFixedNote`）
- 成员身份 = 名牌 + 头像（`components/member-avatar.tsx` 的 `MemberAvatar`，身份解析在 `lib/member-avatar.ts`）
- 计算机/运行时 = 砚台/工具底座；连接命令 = 证明/说明纸（`AttachmentSheet` + `ObjectField`）

共享原语暴露 `data-slot`（组件契约）与 `data-object`（产品物件类）。浏览器证据通过这些属性进行同类比较。物件语言属于共享原语与 `globals.css` 工具类——绝不是路由局部手搓卡片。

头像规则（现行实现）：人类与 agent 共用一个 `MemberAvatar` 组件。身份来源解析在 `lib/member-avatar.ts`（`avatarSourceForMember`）：人类用 `profile.avatarUrl` / `avatarUrl`；agent 在设置了 `config.avatarImageUrl` 时用它，否则用按 seed 生成的 DiceBear croodles-neutral 数据 URI（`generatedAgentAvatarDataUri`；预设 default / friendly / focused / debugger / energetic，经 `config.avatarPreset` 选择）。`lib/smallkhoj-agent-avatar.ts` 是固定表情的预览生成器，只被 `scripts/avatar-preset-preview.ts` 使用，不在成员路径上。状态圆点位于右上角（`statusDotClass`，agent 加一圈 ring），绝不被边框装饰遮挡（折角在左上）；朱砂印章是评审物件，不是身份装饰。

---

## 布局约定

### 三栏 "Slack" 模式（列表-详情页）
具有 列表+详情 结构的页面（任务、成员、计算机、聊天）使用 `<ProductShell list={...}>`：
- **列 0 — 工具脊**（`.sk-rail`，固定 `w-14`，纸装订脊材质）
- **列 1 — 列表列**（`bg-sand-deep`，经 `useResizablePanel` 可调宽，宽度存 localStorage）
- **列 2 — 主区域**（纸面场地）
- **列 3 — 可选右侧栏**（详情/统计，`bg-sand-deep/60`）

### 单栏仪表盘模式
没有列表的页面（首页、控制、设置、daemon）省略 `list` 属性。`ProductShell` 保持向后兼容：无 `list` = 单栏。

### 容器规则
- 主框架容器用 `<Card>`；无边框高密度块用 `<Panel>`。
- 不要在卡片内嵌套卡片。用分区标题 + 间距，而不是边框盒。
- 控件尺寸保持稳定；悬停/状态/计数不得造成布局位移。
- 全宽工作区、侧栏、标签页、分栏、表格——优先于 hero 大区块。

### shell 拥有的材质书桌覆盖（07-06）
- 所有产品路由从 `(app)` 布局继承书桌背景：`app/(app)/layout.tsx` 恰好挂载一次 `InkMaterialRuntimeScript` + `AppDeskBackground`。路由不得挂载自己的书桌背景或第二个材质运行时脚本；按路由的变化在主区域内完成，绝不通过重新拥有书桌实现。
- `/login` 与 `/join/[token]` 是有意例外：在 `ProductShell` 之外、`(app)` 分组之外的干净宣纸入口——无图标栏、无书桌材质层、无 `data-inkframe-surface="app-background"`。不要把它们拉进 shell，也不要在未扩展 `tools/twd-guard/twd-inkframe-proof.mjs` 中 shell 覆盖证明路由（`PRODUCT_SHELL_PROOF_ROUTES`）的情况下给其他非 `(app)` 路由添加书桌材质。

---

## 交互约定

- 常见动作用图标；含义不明显时配 tooltip/标签。
- 标签页用于备选视图，分段控件用于模式，开关用于二元，菜单用于选项集。
- 全应用统一一种标签页样式（不要每页手搓第三种标签页变体）。
- 关键后端变更用原生 `<form action={serverAction}>`（见 `quality-guidelines.md`）。
- 空/加载/错误状态必须解释状态并给出下一步动作，而不是只显示灰字。
- **未读（unread）密度是非对称的（06-22-notifications，反通知焦虑）**：私信未读 = 计数徽标（`EventBadge` 带 `count`）+ 强调行；频道未读 = 仅小圆点（`ActivityDot`，无计数、无强调）。绝不要给频道按消息计数或加粗——频道累积"99+"是噪声，不是信息。未读是易失的本地状态（见 `state-management.md` 中的 Domain × Scope Unread Activity Layer）：进入实体即清除；它不是持久设计数据，不得驱动布局。

---

## 运行时 / 可观测性表面

- 活动、事件（event）、daemon、trace 视图是可观测性 UI：汇总 + 链接到证据。
- 区分用户可见工作（消息、已指派任务）与遥测（事件、状态）。
- 运行时状态标签：Working/Thinking/Output/Idle 是活动；消息/任务是工作。
- 绝不让自己产生的运行时活动看起来像一条新的入站消息。
- `/daemon` 与 `/control` 是内部运维页：它们被排除在物件书桌产品语言检查之外，不得用作风格验收证据。

---

## 记忆与恢复表面

- 频道记忆与任务恢复是压缩后恢复表面，不是调试转储。
- 按产品含义（频道知识、任务输出、提案）分组记忆，而不是一个扁平列表。
- 任务恢复：展示简介、计划、进度、输出/证据、摘要、分解、来源。
- 产物以类型化查看器渲染（图片预览、`<video controls>`、带标签的证据行）。
- 紧凑地展示版本/哈希以供审计；不要让哈希主导层级。

---

## 材质运行时（WebGL 墨色表面）

墨材质层（`components/inkframe/material-surface.tsx`、`material-resource.ts`、`material-surface-store.ts`、`app-desk-background.tsx`）遵循 07-06 材质任务族的硬性运行时规则：

- **全应用最多一个活跃 WebGL 表面，默认静态。** 每个材质表面（书桌背景、聊天书桌、任务材质）默认 `mode="static"`，完全不挂载 `<canvas>`——加载与路由切换零 GL 成本。激活是显式用户动作（聊天书桌按钮），经 `materialSurfaceCoordinator` 协调：每个区域一条活跃记录，在区域内激活新属主会去激活前一个（`app-background` 由 `AppDeskBackground` 拥有，owner-id `global-desk`）。
- **资源是会话局部、仅内存的。** `MaterialResource` blob 存放在模块级被跟踪集合中，用 `URL.createObjectURL` 对象 URL，在页面生命周期/丢弃时回收。把 visual/restore/source blob 持久化到 `localStorage` 或 `IndexedDB` 是禁止的——材质状态是短暂的书桌戏剧，不是用户数据。
- **每个资源三个 URL，以保证保真度。** `visualObjectUrl`（展示的内容）、`restoreObjectUrl`（恢复要回到的基准）、`sourceObjectUrl`（原始上传）。保留使用当前资源；丢弃经 `discardMaterialResource` 回到属主干净的默认值。绝不要把三者合并成一个 URL——恢复质量与来源依赖于这种分离。
- **保留/丢弃必须回落到干净的属主资源，无色偏漂移（drift）。** 每个资源带自己的 `tint`（`desk` | `paper` | `task` | `evidence` | `review`）；保留或丢弃之后，表面仍必须报告属主期望的 `data-inkframe-tint`。被丢弃的表面悄悄继承前一资源的色偏是 bug，不是天气效果。

---

## 已知债务与改进方向

本节列出 spec 与代码之间已验证的差距，以及推荐方向。此处条目**还不是规则**——当某个任务落地它们时才成为规则。

1. **主题命名漂移** — 默认主题叫 `water`，但实际是纸面书桌。推荐：改名为 `desk`（或 `paper`）并做完整存储迁移，或接受该命名并写成文档（本文已完成）。在下一个触及主题的任务里二选一。
2. **图标栏激活强调色太弱** — `sk-rail-active-{blue,rose,mint,green,purple}` 目前只在 3px `::before` 刻度与 76% 墨色混合的阴影色偏上有差异；一眼看去所有激活项都是同一块墨色砖。规划任务 `08-04-frontend-beautification` 针对此项。推荐：用该色相的 **soft** 变体填充激活砖，保留墨色边框 + solid 刻度——在不破坏墨色签名的前提下提供足够的色相识别。
3. **shadcn 残留 token 偏离色板** — `:root` 仍带有 water 时代蓝灰并漏进原子：`--popover: oklch(1 0 0)`（纯白）、`--muted-foreground: oklch(0.55 0.03 225)`（蓝灰对暖墨）、`--border`/`--input: oklch(0.91 0.015 220)`（浅蓝灰对墨色）。推荐：把这些重指向纸面/墨色衍生（`--popover` → `--paper`、`--muted-foreground` → `--sand-muted`、`--border` → `--sand-border`），让消费 shadcn 默认值的原子停止向冷色漂移。
4. **`--radius` 遗留** — `0.875rem` 为 shadcn 内部保留，而产品语言是直角。保留该 token，但对新圆角容器做 lint；不要让圆角经组件库长回来。
5. **Popover/下拉表面** — 纸面书桌上的纯白 popover 读作异物。修复债务 #3 后，popover 变成带墨色边框与硬阴影的纸面，与对话框一致。
6. **水墨强调色混叠** — `.shuimo` 把 `--accent-green` 别名到 `var(--moss)`，同时 mint 与 green 塌缩到同一色相族；成员/活动（mint）与计算机（green）变得难以区分。推荐：在低彩度下分开它们（一个用苔绿 ≈ 150，另一个用更深的松绿 ≈ 165-170），以保留水墨感。
7. **强调色块的双重维护** — 强调色按主题（`:root`、`.dark`、`.shuimo`）手工定义。新增色相时，在同一提交中更新全部三个块；缺失的块会静默回落到错误主题的颜色。考虑在每个块头部加注释清单。

---

## 证据期望

对于面向浏览器的工作，最终证据要展示实际可见的产品表面，而不只是 curl/DB 行。浏览器部分用 `project-webdriver-cli`（`./twd`）；只在相关层重要时交叉核对 API/DB/trace。证据必须展示真实应用（列表/详情表面足够可见，以证明不只是 token 替换）。
