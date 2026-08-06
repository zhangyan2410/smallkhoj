# UI 设计稿：Computers 连接对话框（平台 tabs + 三阶段命令卡片）

本文件是 PRD 中 R4（可观察性）、R8（平台感知）、R9（双语与互斥）、R11（中文命令行引导）、
R12（just-in-time ticket）的 UI 落地设计。视觉依据为刷新后的
`.trellis/spec/frontend/product-ui-style.md`（dry-paper object desk）与根目录 `DESIGN.md`；
组件分层依据 `component-guidelines.md` / `quality-guidelines.md`。
实现时以本文件定布局、状态与文案，以 spec 定视觉与组件分层；二者冲突时在 PR 中同时修正。

## 1. 范围

- 改造现有 `frontend/app/(app)/computers/connect-computer-form.tsx` 的
  `ConnectComputerDialog`，不新增独立 onboarding 路由（PRD 已确认）。
- 覆盖两条产品路径：
  - 新电脑：名称输入 → 平台选择 → Install → Setup → Connect → Online。
  - 已 Setup 电脑重连：只显示 Connect（重连）阶段，不重复展示 Install/Setup（PRD R10）。
- 「电脑已连接」提示 dialog 保持现状，不属于本次改造范围。
- 空状态（0 台电脑）初始自动打开本 dialog 的行为（`initialStepsOpen`）保留。

## 2. 视觉方向：桌面上的「操作指引单」

按 object-desk 语言定位这个对话框：它不是一张 SaaS 卡片，而是**放在工作桌上的一张
操作指引单（instruction sheet）**——用户把它拿到目标电脑前照着做。

- 对话框本身是**工作纸面（sheet）层**：`--paper` 底、2px 墨边、方角、硬偏移阴影
  （现有 Dialog atom 已满足，不改）。永远不倾斜、不旋转。
- 三阶段卡片也是纸面对象：稳定、方正、可读。它们不是「手中微对象」，
  **不使用任何旋转/倾斜**（短消息纸片级别的个性不属于这里）。
- 命令块是**凭证/指引附件（proof sheet）**：沿用 `AttachmentSheet kind="proof"` 的
  `--slip-paper-bg` 材质，等宽字体，视觉上是「别在指引单上的附件」。
- 复制按钮是**附着在附件边缘的小工具**，放在命令块右上角内侧，hover 可上浮 1px
  （与 rail icon 的 hover 语言一致），不被纸边裁切。
- 朱砂（`--cinnabar`）只用一处：**当前可执行阶段**的序号标记（见 §5），作为
  「此刻该做这一步」的印章级强调；不做任何页面着色。
- 平台 tabs 与 Computers 功能色一致：`green` accent（rail 映射 computers=green）。
- 全部颜色走 token；本对话框不引入任何新色。

## 3. 组件组合与分层约束

### 复用现有 atom / product primitive

| 用途 | 组件 | 说明 |
|---|---|---|
| 对话框 | `components/ui/dialog.tsx` | 墨边方角硬阴影已内置 |
| 名称输入 | `components/ui/input.tsx` + `<form action={serverAction}>` | 关键后端写操作必须原生表单提交（quality-guidelines） |
| 按钮 | `components/ui/button.tsx` | 复制、生成连接命令、重新生成、重试 |
| 阶段卡片容器 | `InkframeObjectSurface` / `Panel` | 沿用当前 pending 卡片的材质语言 |
| 命令展示块 | `AttachmentSheet kind="proof"` | 沿用现有 proof 表面 |
| 元数据字段（Server、过期时间） | `ObjectField` | label/value 对齐语法 |
| 状态标识 | `StatusPill`（`components/product-ui.tsx`） | 状态色只走 `badgeClass()`/`dotClass()` |

### 必须新增的共享 atom：`components/ui/tabs.tsx`

当前 `components/ui/` 下**没有 Tabs 组件**（已核实），页面里也没有可复用的 tab 实现。
平台 tabs 必须作为 Layer 1 共享 atom 新增，遵守 spec 的
"One tab style app-wide (do not hand-roll a third tab variant per page)"：

- 结构：`role="tablist"` 容器 + `role="tab"` 子项，选中面板 `role="tabpanel"`。
- 视觉（ink-border 语言）：
  - 每个 tab：`2px solid var(--ink)`、方角、无阴影；
  - 选中 tab：`sk-accent-green` solid 底 + `--accent-green-fg` 字 + `2px 2px 0 var(--ink)`
    硬阴影（B/C 规则：active tabs 用 solid 档）；
  - 未选中 tab：`sk-accent-green-soft` 底 + `--accent-green-soft-fg` 字；
  - hover（未选中）：上浮 1px（`translate(-1px,-1px)`），与 rail icon 一致；
  - 选中/未选中切换只变颜色与阴影，**不变尺寸**，避免布局跳动。
- atom 不绑定 computers/green：hue 通过 prop（如 `accent="green"`）传入，
  默认 `blue`，让后续页面复用同一 atom。
- 工具类必须落在 `@layer components` 设计系统块内（必要时 `!important`），
  防止 Tailwind v4 dev 构建漏出导致「主题消失」。

### 页面层禁令

- `connect-computer-form.tsx` 只做数据准备、server action 和组合；不得在页面层
  定义视觉原语、硬编码颜色、内联 hex/oklch/Tailwind 色板字面量。
- 不为这次需求在页面里手写卡片/标签页/状态徽章/复制按钮样式。

## 4. 布局与信息架构

### 4.1 新电脑路径（完整三阶段）

Dialog（`max-w-2xl`，沿用现有 Dialog atom；窄屏下单列堆叠）自顶向下：

```text
┌ 连接新电脑 ──────────────────────────────────────────┐
│ 三步把电脑接入 SmallKhoj：安装 Aura → 初始化 → 连接     │
│                                                      │
│ 电脑名称 [ my-computer            ]                  │
│                                                      │
│ ┌ Windows ────────┐ ┌ macOS / Linux ────────┐        │  ← 平台 tabs（互斥）
│ └─────────────────┘ └───────────────────────┘        │
│                                                      │
│ ❶ Install（安装）                      [PowerShell]   │  ← 阶段卡片
│   ┌ proof 命令块 ─────────────────── [复制] ┐         │
│   │ irm .../install.ps1 | iex               │         │
│   └─────────────────────────────────────────┘         │
│   按 Win + X 打开终端，粘贴执行；看到成功输出即完成。      │
│                                                      │
│ ❷ Setup（初始化）                      [PowerShell]   │
│   ┌ proof 命令块 ─────────────────── [复制] ┐         │
│   │ aura setup --name "my-computer" ...     │         │
│   └─────────────────────────────────────────┘         │
│   同一窗口继续执行；只写本机配置，不会连接服务器。          │
│                                                      │
│ ❸ Connect（连接）                                     │
│   未生成 ticket：  [ 生成连接命令 ]                    │
│   已生成 ticket：  ┌ proof 命令块 ──── [复制] ┐        │
│                    └──────────────────────────┘        │
│                    过期时间 2026-08-06 18:35           │
│                                                      │
│ 状态区：○ 完成命令后，这里会显示连接结果                 │
└──────────────────────────────────────────────────────┘
```

### 4.2 重连路径（已 Setup 电脑）

```text
┌ 重连 {name} ─────────────────────────────────────────┐
│ 这台电脑已完成安装和初始化，只需重新连接。                 │
│                                                      │
│ ┌ Windows ────────┐ ┌ macOS / Linux ────────┐        │
│ └─────────────────┘ └───────────────────────┘        │
│                                                      │
│ ❸ Connect（连接）                                     │
│   [ 重连 ] → proof 命令块 + 过期时间                    │
│                                                      │
│ 状态区：…                                             │
└──────────────────────────────────────────────────────┘
```

规则：

- 重连路径不渲染 ❶❷ 卡片和名称输入；标题与描述文案切换为重连语义
  （`reconnect` 沿用现有 key，描述新增 `reconnectDesc`）。
- 状态区**始终渲染**（空态显示引导文案「完成命令后，这里会显示连接结果」），
  不出现/消失式布局跳动。
- 三阶段卡片始终按 ❶❷❸ 顺序完整显示；不使用本地「已完成」勾选，
  只有服务器 Online 是最终成功依据（PRD 已确认）。

## 5. 阶段卡片解剖

每张阶段卡片（`InkframeObjectSurface`，方角墨边）由五个槽位组成，对应
object-desk 对齐语法（anchor / primary / meta / state / actions）：

1. **anchor · 阶段序号**：左侧小方块（`2px` 墨边、方角、`--paper` 底、墨字数字
   ❶❷❸）。**当前可执行阶段**的序号方块用 `--cinnabar` 字 + 朱砂边
   （全对话框唯一朱砂用法）：
   - 新电脑路径：Install/Setup 由用户在目标机自行执行，Web 无法知道真实进度，
     「当前可执行」恒为 Connect 之前的引导——因此序号全部保持墨色，
     **只有 Connect 卡片在用户可点击生成时用朱砂序号**；
   - ticket 生成后朱砂退去，恢复墨色，避免持续闪烁的「假进度」。
2. **primary · 阶段名**：双语一行，`Install（安装）` / `Setup（初始化）` /
   `Connect（连接）`，稳定纸面文字，不倾斜。
3. **meta · shell 标识 pill**：右侧 1px 墨边小 pill，等宽字体，Windows 显示
   `PowerShell`，macOS/Linux 显示 `Terminal`，与 tab 标识严格一致。
4. **evidence · 命令块**：`AttachmentSheet kind="proof"` + 等宽 `<code>`
   （`whitespace-pre-wrap break-all`，长命令不断行溢出）；右上角内侧附着
   复制按钮（小工具语言）。
5. **actions · 操作引导**：命令块下方一行 `text-xs text-muted-foreground`
   引导文案（见 §7 文案 deck）。

Connect 卡片的特殊状态（just-in-time，PRD R12）：

| 子状态 | 渲染 |
|---|---|
| 未生成 ticket | 主按钮「生成连接命令」（重连路径为「重连」），`variant="default"` 实色；无任何命令文本、无过期时间 |
| 生成中 | 按钮 loading + disabled，防重复点击产生多个 ticket |
| 已生成 | proof 命令块 + `ObjectField` 过期时间（`expiresAt`，绝对时间，无倒计时动画） |
| 已过期 | 命令块叠加「已过期」标记（沿用 `expired` 文案 + `--warning` 状态色），按钮变为「重新生成」，走同一显式 action，不复用旧 ticket |

## 6. 平台 tabs 行为与视觉

- 两个互斥 tab：`Windows`（shell 标识 `PowerShell`）与 `macOS / Linux`
  （shell 标识 `Terminal`）。
- 初始选中由浏览器平台推断（`navigator.userAgent` / `platform` 含 `Win` →
  Windows），仅决定初始值，不锁定；用户可随时手动切换。
- 任一时刻只有当前选中平台的命令卡片可见、可复制；未选中平台的命令块
  **不渲染进 DOM**（不用 `display:none` 藏一份可复制文本）。
- 切换平台保留已填写的电脑名称；不混用另一平台的命令、预期输出或状态说明
  （PRD R9）。
- 打开弹窗、切换 tab、浏览三阶段卡片都不得触发 ticket 生成请求（PRD R12）。
- tab 切换时三阶段卡片整体替换，无逐卡片交错动画（工作纸面层保持安静）。

## 7. 文案 deck（zh-CN 默认 / en 对照）

全部文案走 `frontend/messages/zh-CN.json` 与 `en.json`，新 key 归
`computers.onboarding.*`。下表是实现对照表（zh-CN 为默认展示，en 为等价信息）：

| key | zh-CN | en |
|---|---|---|
| `dialogDesc` | 三步把这台电脑接入 SmallKhoj：安装 Aura → 初始化本机 → 连接服务器。 | Connect this computer in three steps: install Aura, set up locally, then connect to the server. |
| `reconnectTitle` | 重连 {name} | Reconnect {name} |
| `reconnectDesc` | 这台电脑已完成安装和初始化，只需重新连接。 | This computer is already installed and set up. It only needs to reconnect. |
| `platformWindows` | Windows | Windows |
| `platformUnix` | macOS / Linux | macOS / Linux |
| `phaseInstall` | Install（安装） | Install |
| `phaseSetup` | Setup（初始化） | Setup |
| `phaseConnect` | Connect（连接） | Connect |
| `shellPowerShell` | PowerShell | PowerShell |
| `shellTerminal` | 终端 Terminal | Terminal |
| `installGuideWindows` | 按 Win + X 选「终端」，或开始菜单搜索 PowerShell；粘贴命令后回车。 | Press Win + X and choose Terminal, or search for PowerShell in the Start menu; paste and press Enter. |
| `installGuideUnix` | 打开「终端」(Terminal)，粘贴命令后回车。 | Open Terminal, paste the command, and press Enter. |
| `installExpect` | 看到安装成功输出版本号即完成；失败会给出原因，可重试。 | Done when the installer prints the installed version; failures explain the reason and can be retried. |
| `setupGuide` | 在同一个窗口继续粘贴执行；只写本机配置和身份，不会连接服务器。 | Run it in the same window. It only writes local config and identity — it does not connect yet. |
| `setupExpect` | 输出 machine ID 和配置路径即完成；重复执行安全。 | Done when it prints the machine ID and config path; safe to run again. |
| `connectCta` | 生成连接命令 | Generate connect command |
| `connectGuide` | 点击下方按钮生成一次性连接命令（生成后 5 分钟内有效）。 | Generate a one-time connect command below (valid for 5 minutes once generated). |
| `connectExpect` | 粘贴执行后，状态区会在几秒内显示「已连接」。 | After you run it, the status below shows "connected" within seconds. |
| `copy` | 复制 | Copy |
| `copied` | 已复制 | Copied |
| `regenerate` | 重新生成 | Regenerate |
| `expiredNotice` | 命令已过期，请重新生成；不需要重做安装和初始化。 | The command expired. Regenerate it — no need to redo install or setup. |
| `statusIdle` | 完成命令后，这里会显示连接结果。 | Connection results appear here once you run the commands. |
| `pendingHint` | 等待 {name} 上线…命令执行后通常几秒内完成。 | Waiting for {name}… usually connects within seconds after the command runs. |
| `timeoutTitle` | 还没有收到连接 | No connection yet |
| `timeoutHint` | 确认命令已在目标电脑执行、网络可达、没有被权限拦截；然后重新生成命令重试。 | Check the command ran on the target computer, the network is reachable, and no permission prompt blocked it — then regenerate and retry. |
| `conflictActive` | 这台电脑已有活跃连接。请先停止旧连接，或稍后重试。 | This computer has an active connection. Stop it first, or retry later. |
| `windowsUnavailable` | Windows 安装器暂不可用，请稍后重试，或切换到 macOS / Linux。 | The Windows installer is temporarily unavailable. Retry later, or switch to macOS / Linux. |

既有 key 沿用：`computerName`、`generateConnect`（ Connect CTA 可复用）、
`pendingConnection`、`waitingFor`、`server`、`expires`、`expired`、`connected`、
`reconnect`。现有 `connectDesc`（"生成一次性连接命令"）语义已过时，
由 `dialogDesc` 取代。英文 UI 信息量与中文等价，不允许只翻命令、省略引导。

## 8. 状态矩阵（含视觉映射）

| 状态 | 触发 | UI 表现 | 状态色 | 恢复动作 |
|---|---|---|---|---|
| 初始/预览 | 打开弹窗、切换 tab | 三阶段卡片 + Install/Setup 命令可见；Connect 只有 CTA；状态区 `statusIdle` | — | — |
| 生成中 | 点击 CTA | 按钮 loading/disabled | — | 等待 |
| 等待中 pending | ticket 已生成，daemon 未注册 | `StatusPill` + `pendingHint`；3 秒轮询沿用 | `--info` | 检查命令是否执行；可重新生成 |
| 超时 | 超过等待期限未 Online | `timeoutTitle` + `timeoutHint` | `--warning` | 重新生成 ticket |
| 在线 Online | 服务器注册 + heartbeat | `sk-cat-success` Panel（沿用 `connected` 样式）显示电脑名 | `--success` | 关闭弹窗；保留「连接另一台」入口 |
| ticket 过期 | expiresAt 已过 | 命令块标 `expiredNotice` | `--warning` | 重新生成 |
| 冲突 | 有效 daemon lease / 活跃进程 | `conflictActive` 说明原因 | `--danger` | 停止旧连接 / 等待 / 重试 |
| Windows 不可用 | standalone 未上架/发布失败 | Windows tab 内显示 `windowsUnavailable`，不输出残缺命令 | `--warning` | 重试；切换 macOS/Linux tab |

失败与空态必须解释状态并给出下一步动作（spec：empty/error states must
explain AND offer a next action）。所有状态色只经 `StatusPill`/`badgeClass()`/
`dotClass()` 流出，不在页面层手写。

## 9. 主题适配（water / dark / shuimo）

- 本对话框不感知主题：全部表面/文字/状态/功能色走 token，三主题自动适配。
- `water`（默认）：宣纸底 + 完整 green accent tabs。
- `dark`：蓝灰深底；proof 命令块沿用 token 化的 slip 表面，不出现白底孤岛。
- `shuimo`：accent-green 解析为 moss 系低饱和绿，tabs 选中态仍需可辨认
  （spec 的「墨里透色」规则）；朱砂序号标记在 shuimo 下与印章语言天然一致。
- 验收时 water + shuimo 各出一组 `./twd` 截图（与 `08-04-frontend-beautification`
  的双主题证据要求一致）。

## 10. 动效与交互细节

- 本对话框所有元素属于 sheet 层：**无旋转、无倾斜、无入场动画**。
- 允许的动效仅三种：复制按钮/tab hover 上浮 1px；按钮 `active` 下沉 1px
  （Button atom 已有）；状态文本的颜色过渡（`transition-colors`）。
- 复制反馈：按钮文案变为「已复制」约 2 秒后恢复；只变文案不变按钮尺寸。
- ticket 命令是敏感凭证：不写入 URL，复制是唯一外发途径（design.md §5）。
- 弹窗打开时焦点落在电脑名称输入框（新电脑路径）或平台 tab 容器（重连路径）。

## 11. 可访问性

- 平台 tabs 使用 `role="tablist"` / `role="tab"` / `role="tabpanel"`，
  `aria-selected` 标注当前 tab，支持 ←/→ 方向键切换。
- 每个复制按钮有独立 `aria-label`（指明复制的是哪个阶段的命令）。
- 状态区为 `aria-live="polite"` 区域，Online/失败变化自动播报，不打断输入。
- 阶段序号方块纯装饰（`aria-hidden`），阶段名文本自身携带序号语义。
- 正文与引导文案对比度 ≥ 4.5:1（muted 引导文字用 `--sand-muted`，不用更浅的灰）。

## 12. data-testid 钩子（供 ./twd 与组件测试）

沿用现有 `connect-computer-dialog`、`daemon-connect-command`、
`add-computer-button`，新增：

- `platform-tab-windows` / `platform-tab-unix`
- `platform-panel-windows` / `platform-panel-unix`
- `phase-card-install` / `phase-card-setup` / `phase-card-connect`
- `phase-command-install` / `phase-command-setup` / `phase-command-connect`
- `copy-command-install` / `copy-command-setup` / `copy-command-connect`
- `generate-ticket-button` / `regenerate-ticket-button`
- `connect-status-region`（状态区，含 idle/pending/online/failed 文案）
- `ticket-expires-at`

## 13. 验证要求（UI 部分）

- 使用项目 WebDriver `./twd`（不直接用 Playwright）验证实际可见行为，证据按
  real-test SOP 存入本任务目录 `evidence/`，marker 形如
  `REAL_windows-computer-install-setup-connect_<timestamp>`。
- 必须断言的可见行为：
  1. 默认语言为中文，弹窗内无未翻译硬编码文案（切英文后引导文案等价存在）。
  2. 浏览器平台推断的初始 tab 正确；手动切换后另一平台命令块从 DOM 消失。
  3. 打开弹窗/切换 tab 后 Connect 卡片无命令、无过期时间（证明未创建 ticket）。
  4. 点击「生成连接命令」后才出现 Connect 命令与过期时间；过期后出现
     「重新生成」入口。
  5. macOS/Linux tab 下 DOM 无 `powershell`/`irm` 文本，Windows tab 下无
     `curl|bash`/`npx` 文本。
  6. 重连路径（已有凭证的电脑）只显示 Connect 卡片，无名称输入。
  7. 复制按钮有可见「已复制」反馈。
  8. water 与 shuimo 主题各截图一组，tabs 选中态在两主题下均可辨认。
- 组件测试覆盖状态矩阵中初始/等待中/过期/冲突/不可用五个状态的渲染分支。

## 14. 与既有规范的关系

- `.trellis/spec/frontend/quality-guidelines.md` 的
  "Convention: Daemon Onboarding Shows One Copyable Command" 是已废弃的历史契约
  （PRD Decisions 已确认）。本任务实现并通过可见 UI 验证后，必须把它改写为
  「当前选中平台显示互斥的 Install/Setup/Connect 三阶段命令」，并同步其中的
  testid 断言（`daemon-one-step-command`、`安装命令` 等旧断言随新契约更新），
  避免后续任务恢复单命令 UI。
- 本文件落地的新 `tabs.tsx` atom 需要在 `component-guidelines.md` 的组件清单中
  登记（实现阶段一并完成）。
- 视觉规则如有与本文件冲突的更新，以 `product-ui-style.md` 当前版本为准，
  并在同一 PR 内回本文件修订。
