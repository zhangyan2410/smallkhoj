# 前端优化交接文档

> **给接手 agent**：这份文档整合了一次完整设计探索的结论 + 三个子代理用 impeccable 标准做的全面审查。
> 你的任务：按照下面的优化清单，把 SmallKhoj 前端从「能用的紫蓝 SaaS」提升到「有水+沙灵魂的精致工具」。
> **所有工作基于分支 `feat/three-column-sand-layout`，不要在 main 上做。**

---

## 0. 必读：背景与现状

### 设计目标（一句话）
让 SmallKhoj 前端拥有「阳光穿透水体的中海蓝 + 暖沙」的质感——明亮但不刺眼，像让人想长时间待的工具，不是宣传片。

### 当前状态
- **已完成**（在分支 `feat/three-column-sand-layout`）：
  - 水材质 icon rail（`product-shell.tsx` 的 `.sk-rail` + `rail-water-texture.png` 真实生图底图）
  - 暖沙色系 token（`globals.css` 的 `--sand*`，15 处）
  - ProductShell 三栏能力（`product-shell-body.tsx` + `use-resizable-panel.ts`，可选 list 栏）
  - tasks 页三栏改造（`task-list-panel.tsx` + `task-form-dialogs.tsx`，表单收对话框）
- **未完成**（你的任务）：主题 token 还是紫蓝、chat 自建 shell 没接入、members/computers 还是单栏、大量 AI slop 待清理。

### 参考资料位置（必读）
| 文件 | 作用 |
|---|---|
| `DESIGN.md` | 设计锚点：色板、光感规则、质感边界、禁忌 |
| `zy-think/HANDOFF_OPENDESIGN.md` | 完整探索路径 + 色彩真相 + 失败教训（避免重复踩坑）|
| `zy-think/IMG_20260506_194102.jpg` | **灵魂参考图**（海水沙滩照片，色彩唯一真相）|
| `zy-think/palette_colors.png` | 从参考图提取的色卡 |
| `zy-think/palette_gradient.png` | 纵向渐变带（深蓝258→青蓝184→暖沙64）|

### 关键禁忌（绝对不做）
- ❌ **不用紫蓝**（hue 250-265）——这是旧主题，用户明确不喜欢
- ❌ 不用 glassmorphism、渐变文字（`bg-clip-text`）、霓虹发光、大面积模糊光斑
- ❌ 不用「uppercase tracked eyebrow」（`text-xs uppercase` section header，AI grammar 第一 tell）
- ❌ 不用「identical card grids」「hero-metric template」「ghost-card（border+shadow 配对）」

---

## 1. 核心矛盾：旧紫蓝主题没换（最高优先级）

**这是所有质感问题的根源。** rail 改了水材质、加了暖沙 token，但 `globals.css` 的核心 token（`--primary`、`--ring`、`--background` 等）**全是旧的紫蓝 hue 258-265**。新 token 是「加上去」不是「换掉旧的」，所以全站组件还在渲染紫蓝。

### 1.1 globals.css `:root` token 迁移（必做）

当前值（紫蓝）→ 目标值（中海蓝 hue 205-215 + 暖沙 hue 75-85）：

| Token | 当前（紫蓝） | 目标 | 说明 |
|---|---|---|---|
| `--background` | `oklch(0.991 0.003 264.5)` | `oklch(0.991 0.004 205)` | 近白带极淡冷蓝 |
| `--foreground` | `oklch(0.217 0.037 258.8)` | `oklch(0.22 0.035 215)` | 深蓝灰文字 |
| `--card`/`--popover` | `oklch(1 0 0)` | `oklch(0.995 0.006 75)` | 暖白（沙底感）|
| `--primary` | `oklch(0.541 0.170 260)` | `oklch(0.55 0.13 210)` | **中海蓝（核心）** |
| `--primary-foreground` | `oklch(0.985 0.005 260)` | `oklch(0.985 0.008 200)` | |
| `--secondary` | `oklch(0.960 0.008 253.9)` | `oklch(0.94 0.02 75)` | 暖沙 |
| `--muted` | `oklch(0.960 0.008 253.9)` | `oklch(0.94 0.018 80)` | 暖沙 |
| `--muted-foreground` | `oklch(0.562 0.039 257.9)` | `oklch(0.55 0.035 75)` | |
| `--accent` | `oklch(0.944 0.014 258.3)` | `oklch(0.93 0.04 200)` | 浅水 |
| `--accent-foreground` | `oklch(0.479 0.164 260.7)` | `oklch(0.45 0.12 205)` | |
| `--border`/`--input` | `oklch(0.916 0.016 257.2)` | `oklch(0.90 0.02 75)` | 沙边 |
| `--ring` | `oklch(0.541 0.170 260)` | `oklch(0.55 0.13 210)` | 与 primary 一致 |
| `--chart-1` | `oklch(0.541 0.170 260)` | `oklch(0.55 0.13 210)` | 主色跟随 |
| `--sidebar` | `oklch(0.978 0.005 258.3)` | `oklch(0.97 0.012 80)` | 暖沙 |
| `--sidebar-foreground` | `oklch(0.30 0.030 258)` | `oklch(0.32 0.03 75)` | |
| `--sidebar-primary` | `oklch(0.541 0.170 260)` | 同 `--primary` | |
| `--sidebar-accent-foreground` | `oklch(0.479 0.164 260.7)` | 同 `--accent-foreground` | |
| `--sidebar-border` | `oklch(0.916 0.016 257.2)` | 同 `--border` | |
| `--sidebar-ring` | `oklch(0.541 0.170 260)` | 同 `--ring` | |

**保留不动**：`--destructive`（红橙 hue 27）、`--success`（绿 hue 145）、`--chart-2..5`（已是多元色）、`--radius`（0.875rem 合理）。

### 1.2 `.dark` 主题块同样迁移

`.dark` 块（globals.css:110-144）所有 hue 251-260 平移到 205-215。关键：`--background: oklch(0.20 0.025 215)`、`--primary: oklch(0.66 0.11 205)`。保持与 light 同色相系。

### 1.3 杀掉紫蓝渐变变量（必做）

`--gradient-primary` / `--gradient-active` / `--gradient-brand`（globals.css:52-54 和 90-92，**两处重复定义都要改**）当前都是 `oklch(0.60 0.18 260) → oklch(0.55 0.20 290)`（蓝→紫渐变）。
- **建议**：要么删掉改用实色，要么换成 `135deg, oklch(0.55 0.13 210) → oklch(0.52 0.10 195)`（中海蓝→深水青）。

### 1.4 `.dark body` 的紫蓝光晕（必做）

globals.css:168-169 的 `radial-gradient(... oklch(0.26 0.042 265 / 0.6))` 是 hue 265 紫蓝大光斑。
- **建议**：改成 `oklch(0.30 0.06 200 / 0.5)`（水色光晕），或直接删掉（暗色背景用纯色）。

### 1.5 agent 身份色 `--agent-color-1..6`（globals.css:56-61 + 93-98，两处）

| Token | 当前 | 建议 |
|---|---|---|
| `--agent-color-1` | hue 260 紫 | `oklch(0.60 0.13 205)` 中海蓝（主 agent 色）|
| `--agent-color-2` | hue 290 品红 | `oklch(0.65 0.15 45)` 暖橙沙 |
| `--agent-color-3..6` | 青200/绿155/黄75/红15 | **保留**（已偏自然）|

---

## 2. 浅色默认 + 光感地基（必做，否则前面改动都看不到）

### 2.1 反转默认主题为 light
`app/layout.tsx:35,38` 的内联脚本无条件 `classList.add('dark')`。
- **改成**：无存储主题时**不**加 `.dark`（light-first），只有用户显式选 dark 才加。

### 2.2 light body 加水面明度渐变
`globals.css:162-166` 的 light `body` 只有 `bg-background`，完全平。
- **改成**：`background: linear-gradient(to bottom, oklch(0.985 0.008 220), oklch(0.96 0.01 220)) fixed;`（顶亮→底略沉，模拟水面）。这是整个「阳光穿透水体」感的地基。

---

## 3. 组件层 AI slop 清理

### 3.1 主按钮（`components/ui/button.tsx:11`）—— 最高优先级
当前 `default` variant：`bg-gradient-primary text-primary-foreground hover:opacity-90`（紫蓝渐变，影响全站每个主按钮）。
- **改成**：`bg-primary text-primary-foreground hover:shadow-[0_0_0_4px_oklch(0.55_0.13_210/0.18)]`（实色中海蓝 + 柔和光晕，非渐变）。
- `transition-all` → `transition-colors`（避免动画 layout 属性）。

### 3.2 Card 去 ghost-card（`components/ui/card.tsx:15`）
当前 `border bg-card ... shadow-sm shadow-slate-200/40`（border + shadow 配对 = ghost-card 禁令，`shadow-slate-200/40` 硬编码灰）。
- **改成**：二选一——去掉 border 只留极轻 shadow（blur ≤8px），或去掉 shadow 只留 border。`shadow-slate-200/40` 换成 token 化的 `shadow-black/5`。

### 3.3 首页渐变文字（`app/page.tsx:339`）—— 绝对禁令
`<h1 className="bg-gradient-brand bg-clip-text text-transparent">`（紫蓝渐变文字）。
- **改成**：`text-foreground` 纯色，靠字号+字重做层次。

### 3.4 硬编码紫蓝（`product-shell.tsx:88` + `channel-client.tsx:1071`）
- rail 激活态竖条 `before:from-[oklch(0.60_0.18_260)] before:to-[oklch(0.55_0.20_290)]`（紫→品红）→ 换成 `before:from-[oklch(0.55_0.13_210)] before:to-[oklch(0.50_0.11_185)]`（海蓝→青）。
- logo `from-primary to-[oklch(0.66_0.14_262)]`（硬编码紫蓝）→ `to-primary` 或 `to-[oklch(0.55_0.12_195)]`。

### 3.5 uppercase eyebrow 滥用（全站几十处）
`text-xs font-medium uppercase text-muted-foreground` 作为 section/label header，出现在：
- `tasks/page.tsx` FieldLabel（被复制几十次）
- `members/page.tsx:94,293,320,340,403,429,457,538,579`（~9 处 section header）
- `computers/page.tsx:385,429,459,474,506`
- **全部改成**：`text-sm font-medium text-foreground`（正常大小写、正常颜色）。

---

## 4. Chat 接入统一 shell（最大一致性缺口）

**chat 是最高频使用页，它脱离体系 = 用户绝大多数时间看到的是旧紫蓝 SaaS 感。**

`channel-client.tsx` 自建了一套 shell（1063-1107 是自己的 rail，没用 ProductShell），必须接入：
1. **删掉自建 rail**（1064-1105），改用 ProductShell 的 `.sk-rail` 水材质。
2. **logo 紫蓝渐变**（1071）→ 跟 product-shell 一致。
3. **channel 列表栏**（1107-1264）`bg-sidebar` → `bg-sand-deep` + `border-sand-border`。
4. **拖拽手柄**（1260）→ 复用 `.sk-resize-handle`。
5. **DM 未读**（1185-1202）：`border-l-2` 彩色竖条（禁令）→ 改小圆点；`bg-red-500` badge → `bg-primary`。
6. ChannelClient 内部 1890 行逻辑**不动**，只改外层 shell 接入。

---

## 5. 布局一致性：members/computers 接入三栏

当前只有 tasks 是三栏，members/computers 还是单栏 dashboard（detail + list 全堆主区）。

- **members**（`members/page.tsx`）：MemberDetail（7 tab 大卡）移到右栏/sidebar；主区只放 gallery。侧栏 3 个统计卡删掉或压成一行。
- **computers**（`computers/page.tsx`）：ComputerListRow 列表 → Col1 列表栏；ComputerDetail → 主区。主区 + sidebar 两套重复统计（registered/online/running）删掉一组。
- 都复用 ProductShell 的 `list` prop（像 tasks 那样）。

---

## 6. 质感收尾项（中低优先级）

### 6.1 统一状态色（当前 3 套并行）
`product-ui.tsx statusStyles` / `tasks dotClass` / `page.tsx amber-sky pill` / 各处硬编码 emerald-rose-sky。
- **收**到一个地方（如 `lib/status-styles.ts`），所有 status→color 走它。

### 6.2 统计卡重复（4 处同构）
home / members sidebar / computers sidebar / computers main / tasks main 都是「3 张 CardDescription+大数字」hero-metric template。
- tasks 的 3 张统计卡 → 压成 Toolbar 里一行 inline KPI（`Total 12 · Open 5 · Agents 4`）。

### 6.3 Field/Select 组件重复
members `:91` 和 computers `:264` 各有一份 Field；tasks 有局部 Select。已抽到 `components/ui/form.tsx`（FieldLabel + Select），其他页改用它。

### 6.4 task-list-panel 激活态冷白（`task-list-panel.tsx:71`）
`bg-white shadow-sm` → `bg-sand-card shadow-sm`（暖沙白，不用冷白）。

### 6.5 圆角封顶
`--radius-3xl`（30.8px）/ `--radius-4xl`（36.4px）超出 impeccable 的 12-16px 上限，删掉或封顶 `*1.4`。

### 6.6 members AgentCard（`members/page.tsx:202`）
`ring-1 ring-primary/10 hover:scale-[1.02]`（双重描边 + 悬停放大跳动）→ 删 ring 和 scale，用 `hover:border-primary/40`。

---

## 7. 执行顺序建议（给接手 agent）

**第一阶段（地基，改完全站自动好转大半）**：
1. §2.1 light 默认 + §2.2 body 光感渐变
2. §1.1 `:root` token 换中海蓝/暖沙 + §1.2 `.dark` 跟换
3. §1.3 杀渐变变量 + §1.4 暗色光晕 + §1.5 agent 色
4. §3.1 主按钮实色 + §3.2 Card 去 ghost + §3.3 首页渐变文字

**第二阶段（一致性）**：
5. §4 chat 接入 ProductShell/水材质/暖沙
6. §5 members/computers 三栏

**第三阶段（收尾）**：
7. §3.4 硬编码紫蓝 + §3.5 uppercase eyebrow + §6 全部

**验证**：每阶段做完跑 `npm run dev` + `./twd` 截图核对；`npm test`（注意 `member-avatar.test.tsx` 只验 `var(--agent-color-` 前缀，换色不会失败）。

---

## 8. 不要做的事（明确边界）

- ❌ 不回退 rail 水材质（`rail-water-texture.png` 是对的，CSS 画不出焦散/光散射）
- ❌ 不重构 ChannelClient 内部 1890 行聊天逻辑（只改外层 shell）
- ❌ 不引入状态管理库（Zustand/SWR）
- ❌ 不把 dashboard 页（home/control/settings/daemon）强行三栏
- ❌ 不用 hue 250-265 的紫蓝（绝对禁忌）

---

*文档基于分支 `feat/three-column-sand-layout`（commit 6b7a91f）。所有 file:line 为该分支版本。
审查来源：impeccable 标准 + 3 个子代理并行探索（视觉审查 / 参考图对照 / 主题 token 审计）。*

---

# 第二部分：边框语言 + 架构层 + 遗留清理清单（更新版）

> 本部分基于「手作墨色描边」风格的确定（Croodles 头像 + raft 边框），以及为解决「改一处管不到全站」问题而建立的架构层。
> **架构层已建好（状态色单一真源 + 补齐共享组件 + 工具类），现在清理遗留是高效的**：大部分只需把裸元素换成共享组件/工具类，改完自动跟随。

## A. 已确定的边框语言（手作墨色描边）

| 元素 | 规格 | token/类 |
|---|---|---|
| 描边色 | `#111827` 蓝灰墨（跟 Croodles 头像 stroke 同色）| `--ink` |
| 圆角 | **全部直角**（border-radius: 0），小圆点/状态点除外 | `rounded-none` |
| 卡片/对话框/面板 | 2px 墨边 + 2px 硬阴影（offset 不模糊，贴纸感）| `Card` / `.sk-panel-raised` / `.sk-hard-shadow` |
| 消息气泡 | 2px 墨边 + **无阴影**（密集不闹）| `.sk-panel` |
| 按钮 | 实色中海蓝 + 2px 墨边 + 直角，hover 加硬阴影 | `Button`（已改） |
| 输入框/Select/Textarea | 2px 墨边 + 直角，focus 变中海蓝 | `Input`/`Select`/`Textarea`（已改） |
| 状态胶囊 | 实色状态底 + 对比字 + 1px 墨边 + 直角 | `.sk-status-*` / `StatusPill` |

**核心原则**：拒绝 SaaS 的「圆角 + 渐变 + 柔和阴影 + 玻璃」。用「直角 + 墨色硬描边 + 实色 + 暖沙底」表达手作温度。头像（Croodles 粗墨线 3.5px #111827）和边框（2px #111827）共享同一墨色，形成统一视觉签名。

## B. 已建好的架构层（治本：让改动自动扩散）

### B1. 状态色单一真源（已建）
- **token**（globals.css `:root`）：`--success`/`--warning`/`--info`/`--danger` + 对应 `-fg` 字色
- **工具类**：`.bg-success`/`.sk-status-success` 等
- **单一真源函数**：`lib/control-plane.ts` 的 `statusKind(status)` → 返回语义分类；`badgeClass(status)`/`dotClass(status)` 都基于它
- **StatusPill**（`components/product-ui.tsx`）：已改用 `badgeClass`，不再有硬编码 emerald/amber/sky/rose
- **改状态色**：只改 globals.css 的 4 个 token，全站 StatusPill/dot/badge 自动跟随

### B2. 补齐的共享组件（已建）
| 组件 | 文件 | 替代的裸元素 |
|---|---|---|
| `Textarea` | `components/ui/form.tsx` | 3 处裸 textarea（tasks/control/task-board）|
| `Select`（已加 className） | `components/ui/form.tsx` | 十几个裸 select |
| `Panel` + `PanelTitle` | `components/ui/panel.tsx` | 满地的 `rounded-md border bg-background p-3` 裸 div |
| `FieldLabel`（去 uppercase） | `components/ui/form.tsx` | — |

### B3. 风格工具类（已建，globals.css `@layer utilities`）
| 类 | 作用 | 替代的写法 |
|---|---|---|
| `.sk-ink-border` | 2px 墨边 + 直角 | `border-2 border-[var(--ink)] rounded-none` |
| `.sk-hard-shadow` | 2px 硬阴影 | `shadow-[2px_2px_0_var(--ink)]` |
| `.sk-panel` | 墨边 + 暖白底 + 直角（无阴影） | `rounded-md border bg-background p-3` |
| `.sk-panel-raised` | 墨边 + 暖白底 + 硬阴影 | 同上但需要浮起 |
| `.sk-status-*` | 状态胶囊（实色底+字+墨边） | emerald/amber/sky/rose 硬编码 |

## C. 遗留清理清单（现在可以高效做了）

> 架构层建好后，清理遗留大部分是「把裸元素换成共享组件/工具类」的机械替换。按优先级：

### C1. 删除重复的局部状态色定义（最高优先级，治本已完成一半）
- `app/daemon/page.tsx:298-397`：删掉本地 `dotClass`/`badgeClass`/`statusLabel`/`StatusBadge`，改 import `lib/control-plane.ts` 的版本
- `app/tasks/page.tsx:375-396`：删掉本地 `dotClass`，改 import
- `app/computers/page.tsx:260`、`app/members/page.tsx:95`、`components/task-board.tsx:104`、`components/task-dnd-board.tsx:24`：删掉本地 `StatusBadge` 包装，直接用 `StatusPill`

### C2. 裸元素 → 共享组件（机械替换）
- **裸 select**（~12 处）：换 `<Select>` from `@/components/ui/form`。位置见子代理清单 5c
- **裸 textarea**（3 处）：换 `<Textarea>`。`tasks/page.tsx:621`、`control/taskrun-templates:194`、`task-board.tsx:455`
- **裸 button**（channel-client 21 处 + 其他）：换 `<Button variant size>`。channel-client 的消息动作栏抽 `<MessageActions>` 组件
- **裸 div 卡片块**（满地）：换 `<Panel>` 或 `<Card size="sm">`

### C3. 圆角/边框/阴影收口（批量替换模式）
最大头是 `rounded-md border bg-background p-3` 这个模式，全站几十处。批量替换策略：
- 信息块 → 加 `sk-panel`
- 需要浮起 → 加 `sk-panel-raised`
- 选中态 `border-primary/xx` → 改 `border-[var(--ink)]`（墨边）+ 实色填充表达选中

### C4. chat 页接入（见第一部分 §4，未变）
channel-client 的自建 rail + 紫蓝 logo + bg-background 聊天区 → 接入 ProductShell 水材质 rail + bg-sand（聊天区已改）+ 墨边气泡。

## D. 给接手 agent 的执行顺序

1. **先做 C1**（删重复状态色）—— 这是治本的关键，删完状态色全站统一
2. **再做 C2**（裸元素换共享组件）—— 机械替换，每换一个全站受益
3. **最后做 C3/C4**（圆角/阴影/chat 接入）—— 视觉收尾

每步做完跑 `npx tsc --noEmit` + `npx eslint` + `./twd` 截图验证。

## E. 为什么这样设计（治本方法论）

之前的问题是「改一处管不到全站」——根因是风格规则散落在 token + 共享组件 + 各页面硬编码三层，没有单一真源。

现在的架构：
- **token 层**（globals.css）：所有颜色的真源
- **共享组件层**（components/ui/ + product-ui）：所有 UI 元素的真源，引用 token
- **页面层**：只用共享组件 + 工具类，不硬编码颜色/圆角/阴影

这样改风格 = 改 token/组件 = 全站自动跟随。清理遗留就是「把页面层的硬编码归化到共享组件」，归化完成后，以后任何风格调整都只需改一处。
