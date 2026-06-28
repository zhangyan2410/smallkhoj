# 前端手作风多彩重构 · 收尾总结

合并自分支 `feat/three-column-sand-layout`（33 commits）。本次工作的核心是建立**单一真源的设计系统**，让"改一处、全站传播"成立，并把所有页面对齐到"阳光透中海水 + 暖沙"的手作风墨边语言。

色彩主题最终确定：**B（水彩马卡龙）做底色 + C（童书手绘）做强调**，同色相双档；允许 C 手绘黄点缀，不要琥珀金。参见 [`docs/design/color-options.html`](design/color-options.html)。

---

## 1. 设计系统基础

### 1.1 三层组件模型
- **tokens**（`globals.css`）→ **atoms**（`components/ui/`）→ **product primitives**（`components/`）→ **pages**（`app/`）
- 单一真源：状态色 `statusKind()`/`badgeClass()`/`dotClass()`、分类色 `sk-cat-*`、功能色 `sk-accent-*` 各管一摊，不混用。

### 1.2 B/C 双档 accent 色彩体系（`globals.css` `--accent-*`）
每个色相两档，保证对比度 ≥4.5:1（solid 配白字、soft 配深字）：

| Hue | solid (C) | soft (B) | 语义 |
|---|---|---|---|
| blue | `#1e6fb8` | 雾蓝 `#5b9bc9` | 聊天 / 链接 / 主操作 |
| rose | `#d63838` | 玫瑰 `#d98a9e` | 任务 / 安全 / 收藏 |
| mint | — | `#6fb89a` | 成员 / runtime / 记忆 |
| green | `#2fa84f` | — | 电脑 / 文件 |
| purple | `#6b4ba0` | 雾紫蓝 `#8a9bc9` | 控制面 / 动态 |
| yellow | `#f2c12e` | — | 仅点缀（不要金/琥珀） |

工具类 `.sk-accent-<hue>{,-soft}`、`.text-accent-<hue>`、`.border-accent-<hue>`。**注意**：这些自定义类放在 `@layer utilities` 之外并加 `!important`——Tailwind v4 会 tree-shake layer 内的未识别工具名，放进 layer 会被静默丢弃。

### 1.3 导航色 = 功能色
icon rail 每个功能区配 accent 色（`.sk-rail-active-<accent>`）：chat=blue、tasks=rose、members=mint、computers=green、control=purple、activity=mint。

### 1.4 手作风墨边语言
- 2px `--ink`（#111827）边、`rounded-none` 直角、硬偏移阴影 `sk-hard-shadow`（2px 2px 0）
- 无 SaaS 软阴影、无圆角（头像/状态点除外）、无单一蓝滥用

---

## 2. 页面级改动

### chat 页面（核心）
- **markdown 双重规则 bug 修复**：globals.css 曾有两套 markdown 规则，SaaS 风格的覆盖了手作风——消息正文实际是灰底圆角。删掉 SaaS 覆盖后，正文恢复薄荷 code 墨边 + accent-blue 链接 + 玫瑰 blockquote。
- **reaction 按钮** `rounded-full` → 直角墨边；**thread 回复按钮** link 下划线 → 墨边 chip；**task badge** 加墨边改 rose。
- **tab 按功能分色**（聊天=蓝、任务=玫瑰、记忆=薄荷、文件=绿、动态=紫），用共享 `Button` atom。
- **发言人名 = agent 头像色**（人=墨色）；role 标签 agent=蓝浅底、人=灰浅底。
- **@提及 / #频道高亮**：remark 插件 + rehype-raw，`@user`→玫瑰 chip、`#channel`→蓝 chip（`#` 后必须字母，避免 `#1` 任务号误匹配）。
- **侧边栏 Section 分色**（关注=玫瑰、频道=蓝、私信=薄荷、运行中=紫）。
- **消息气泡**：`.sk-bubble` 书卷纸底（`--paper`），hover 显墨边。
- **message 内容宽度可调**，与 thread 共用一条拖拽线（thread 变宽则 message 自动变窄，永不溢出）。
- **成员列表**：默认隐藏，点头部"成员"按钮弹出抽屉；"添加成员"从底部移到顶部。
- **DM 头部不再闪 `DM @<uuid>`**：服务端 page 现在也拉 `/api/v1/dms` 并 join peer，首屏 SSR 即干净名字。
- 暖沙底次要文字 `text-muted-foreground`（冷灰）→ `text-sand-muted`（暖）；composer Input → `bg-paper`。

### members 页面
- **agents 按 computer 分组**（不再是 kind 二分）：每台 computer 一个 green accent section，未绑定→yellow，humans→mint。
- **抽 `findMemberWorkspace(member, computers)` helper** 收口 3 处重复的 member→workspace join。
- **删掉主区 agent 卡片画廊**（impeccable 反对 identical card grids）；主区只显示选中成员详情。
- **侧边栏选中 agent → 内联生命周期控制**（start/stop/restart，按状态桶 gating）。
- **创建智能体**：从虚线 SaaS 卡片 → actions 栏 `CreateAgentDialog` 按钮。
- **选中态记忆**：`RestoreMemberSelection` 用 sessionStorage，切走再切回不丢选中。

### tasks 页面
- **任务详情从固定 `lg:w-80` sidebar 改为大 Dialog**（`TaskDetailDialog`，max-w-4xl，URL-driven `?task=`）。
- 看板卡片点击 → 导航 `?task=` → 打开 dialog（原来只改本地 state 无反馈）。

### daemon / control / settings / landing
- 全站 accent 推广：settings（Safety/API Keys→rose、Runtime→mint）、landing（5 section 分色）、daemon（控制面→紫）、computers（raw 色→token）、memory-entry-surface（→mint）、taskrun-templates（→rose）。
- 清掉所有 raw Tailwind palette 色（sky/amber/emerald/rose-600 等）→ token。
- gates/runs 保持 `sk-cat-*` 状态语义色（正确，不动）。

---

## 3. 关键约束/坑（给后续 agent）

1. **`sk-accent-*` 必须在 `@layer utilities` 之外**——否则 Tailwind v4 tree-shake 会丢。
2. **chat 是核心页**，逐元素对照设计语言，不要塞到"收尾"草草带过。
3. **`data-region`** 必须打在多面板页的主要区域容器上（chat 已有：chat-main/message-list/composer/thread-panel/members-panel），否则"截图/语言描述位置"无法反查到代码。
4. **可拖拽面板**：thread 和 message 共用一条拖拽线 = 只调 threadWidth，message 区域用 `flex-1` 自动收缩（不要各自独立 clamp，否则会溢出）。
5. **状态色（success/warning/info/danger）≠ 功能色（accent）≠ 分类色（cat）**——三套职责不重叠，不要混用。

---

## 4. 验证
- typecheck：clean
- 测试：35/35 pass
- 浏览器（twd）实测：rail 配色、chat 手作风多彩、members 分组 + 侧边栏 lifecycle、tasks 大 dialog、DM 标题无闪烁
- 全站 0 处 raw Tailwind palette 色

## 5. 已知待办
- **impeccable 完整 critique**：本次按约束自查修复，未跑 `$impeccable critique` 全量评分。
- **chat `@mention` 颜色目前是统一玫瑰**：理想是 @人名用该人 palette 色（需把成员列表传入 MarkdownMessage）。
- **task detail dialog 内容**：目前复用原 TaskDetail，分栏（左活动/右评审）可进一步打磨。

## 6. spec 文档
- `.trellis/spec/frontend/product-ui-style.md`：已补 accent B/C 双档 + 功能色映射 + 导航配色规则。
- `.trellis/spec/frontend/component-guidelines.md`：已补 `data-region` 约束 + 手作风常见错误。
