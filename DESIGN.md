# SmallKhoj Design System

本文件是 SmallKhoj 前端的视觉锚点。任何配色/质感改动以此为准；impeccable 与落地代码都参照本文件。

> **方向声明（2026-08 修订）**：本文件早前描述的「阳光穿透水体的中海蓝 + 沙滩」方向
> 已被后续决策取代。当前生效方向是 **Inkframe 干燥宣纸工作桌（dry-paper object desk）**，
> 由已完成任务 `06-30-ink-wash-theme-exploration` 定稿并已落到默认主题。
> 旧的「light-first + 中海蓝 + 光感」内容仅保留在此声明中作历史记录，不再作为依据。
> 组件级细则见 `.trellis/spec/frontend/product-ui-style.md`（单一权威），对象隐喻全集见
> `.trellis/tasks/archive/2026-07/06-30-ink-wash-theme-exploration/design.md`。

## 设计意图（一句话）

一张明亮干净的工作桌：宣纸桌面、暖松烟墨线、朱砂印章。界面是「桌面上摆放的工作对象」
（纸片、票据、凭证、印章、砚台），不是 SaaS 卡片。是一个让人想长时间待着的工具，
克制、可读、有手作感，但不牺牲任何可用性。

## 三个视觉层（产品表面层级）

| 层 | 内容 | 规则 |
|---|---|---|
| 桌面环境（desk） | 全局背景 | 明亮干宣纸 + 极淡纤维/格线；永不容湿墨、粉调、脏灰、状态色 |
| 工作纸面（sheet） | shell / 列表栏 / 主区 / 侧栏 | 稳定、方角、可读的纸面；不倾斜、不游动、无装饰泼溅 |
| 手中对象（hand objects） | 消息、凭证、印章、附件、任务票、运行材质 | 唯一允许个性的层：短消息微斜、印章动作、局部 hover 浮起 |

实现对应：`globals.css` 拥有 `--desk-paper-bg` / `--sheet-paper-bg` / `--slip-paper-bg`，
shell 表面必须消费这些变量，不得在路由内重建背景。

## 色板（当前生效值，摘自 `globals.css`）

| Token | 值 | 角色 |
|---|---|---|
| `--paper` / `--background` | `#f6f1e2` | 宣纸底：暖白矿物调，非纯白 |
| `--paper-cool` / `--sand` | `#f1efe8` | 干纸场（列表栏/主区底层） |
| `--paper-deep` / `--sand-deep` | `#e2dac7` | 纸影（侧栏/深处层次） |
| `--ink` / `--foreground` | `oklch(0.205 0.028 78)` | 暖松烟墨：文字 + 全部描边，非浏览器纯黑 |
| `--cinnabar` | `oklch(0.50 0.17 32)` | 朱砂：印章/关键强调专用，不做页面着色 |
| `--moss` | `oklch(0.48 0.088 150)` | 苔绿：克制的材质/状态点缀 |
| `--amber` | `oklch(0.66 0.12 74)` | 琥珀：克制的材质/状态点缀 |
| `--primary` | `oklch(0.62 0.13 215)` | 中海蓝：仅主按钮/链接/focus 的品牌强调（历史保留，用量克制） |

## 描边语言（核心视觉签名）

- 所有带框元素：`2px solid var(--ink)`、方角（`rounded-none`）、硬偏移阴影
  （`2px 2px 0 var(--ink)`，无 blur）。已在 `ui/card/button/input/dialog` 全部核实。
- 允许圆角的只有小圆点/状态指示（`rounded-full`）。
- 禁止：soft SaaS 阴影、玻璃拟态、渐变文字、border + soft shadow 的「幽灵卡」。
- `--radius: 0.875rem` 是 shadcn 兼容层的历史保留；产品 atom 一律 `rounded-none`，
  新代码不得依赖 `--radius` 做圆角容器。

## 三主题机制（当前实现）

主题切换器（`components/theme-switcher.tsx`）三选一，持久化 `localStorage.theme`：

| 主题 | `<html>` class | localStorage | 定位 |
|---|---|---|---|
| water（默认） | 无 | `null`（移除 key） | 默认桌面：干宣纸 + 墨 + 完整 B/C 六色功能色 |
| dark | `.dark` | `"dark"` | 蓝灰深底（非纯黑），品牌色提亮一档 |
| shuimo | `.shuimo` | `"shuimo"` | 明生宣 + 暖松烟墨 + 朱砂；功能色「墨里透色」低饱和可辨认 |

- 历史命名债：默认主题叫 `water` 是沿用旧方向的名字，其内容已是宣纸桌面；
  改名属于兼容性改动，任何改名必须同步 `theme-switcher.tsx`、
  `localStorage` 迁移和设置页文案，不得只做一半。
- 规范中曾出现的 `.theme-ink` / `localStorage.theme = "ink"` 契约从未落地，已作废；
  真实契约就是上表。

## 质感边界

- 旋转不是全局风格：只有刻意手放的微对象可旋转（短消息纸片、印章、胶带条、
  凭证 hover）；shell、任务面板、composer、侧栏、列表、长文、工具栏、
  电脑/运行时底座必须方正稳定。
- 朱砂只用于印章/关键标记，不做页面底色；粉/玫瑰面不是背景语言。
- 正文对比度 ≥ 4.5:1；placeholder 同样 ≥ 4.5:1。
- 湿墨/WebGL 材质效果只能是局部对象（如运行时卡片），不得淹没整页背景。

## 规范维护规则

- 本文件只回答「方向与意图」；token 表、组件分层、禁忌清单的权威版本在
  `.trellis/spec/frontend/product-ui-style.md`，两份文件不一致时以后者为准并回本文件修订。
- 改色只改 `globals.css` token；任何组件内硬编码颜色都是违规。
- 浏览器可见改动用 `./twd` 出真实截图证据（见 frontend spec 的 Evidence 部分）。
