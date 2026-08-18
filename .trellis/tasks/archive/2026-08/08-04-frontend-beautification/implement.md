# 前端全面美化优化 — 实施记录

## 批次一：配色系统修复（globals.css）

**根因**：配色「丢失」不是变量被删，而是
(a) 用户机器主题存的是 `shuimo`，其第二覆盖块把 `--accent-blue` 压成 `var(--ink)`、`--accent-purple` 压成 `--ink-soft`；
(b) `.sk-rail-active-{blue,rose,mint,green,purple}` 五变体视觉完全一致（死代码），rail 功能色配置从未生效。

**改动**（`frontend/app/globals.css`）：

1. `sk-rail-active-*` 六色差异化（utilities 层 + components 层两处同步）：
   - `::before` 竖条：`--accent-blue/rose/mint/green/purple` 各自对应；
   - box-shadow：同色系 76% mix ink；默认 `sk-rail-active` 保留朱砂。
2. `:root`（water 默认主题）提亮：
   - accent-solid 全色系 chroma +0.01~0.02，soft 档 L 提到 0.78~0.90（soft 底色在纸面上更可见）；
   - `--cat-*` 分类色 chroma 0.05→0.07~0.09、fg chroma 提升；
   - `--avatar-tint-*` chroma 0.02~0.03→0.04~0.05。
3. `.shuimo` 第二覆盖块恢复功能色可读性（保留宣纸底 + 墨边签名）：
   - `--accent-blue` 从 `var(--ink)` 改为靛蓝 `oklch(0.42 0.07 255)`；
   - `--accent-purple` 从 `var(--ink-soft)` 改为黛紫 `oklch(0.40 0.06 290)`；
   - rose/yellow/mint/green 相应提鲜艳，soft 档 mix 比例提高。

## 批次二：i18n 全面中文化

**新增 messages key**（zh-CN.json 与 en.json 同步追加，zh 默认中文）：
- `members.*`：+61 个（详情页全部：detailTitle/delete/runtimeBinding/field* /tab* 外全部内容文案 + activity-tab 生命周期）
- `chat.*`：+38 个（desk/annotation 按钮、create-channel-dialog、create-agent-dialog/form、agent-activity-list）
- `tasks.*`：+7 个（拖拽提示/loading/updateFailed 等）
- `home.*`：+3 个（搜索空态）

**页面/组件改造**：
- `members/page.tsx`：790 行详情区 7 个 tab 全部接入 `getTranslations("members")`；memberTabs 改为 key→labelKey 映射；listTitle/actions 按钮接 key。
- `members/activity-tab.tsx`：全部文案接入 `useTranslations("members")`。
- `chat/layout.tsx`：title/description/listTitle 接入 `getTranslations("chat")`。
- `chat/[channel]/channel-client.tsx` + `message-list.tsx`：desk/annotation aria-label/title 接入 tChat。
- `chat/[channel]/create-channel-dialog.tsx`：整组件接入 `useTranslations("chat")`。
- `chat/[channel]/create-agent-dialog.tsx` + `components/create-agent-form.tsx`：接入 `useTranslations("chat")`。
- `components/agent-activity-list.tsx`：Thought/Command/tokens/raw details/Activity/Refresh/loading/empty 接入 `useTranslations("chat")`。
- `app/(app)/page.tsx`（home）：SearchResults 接 t；nav actions 按钮接 tNav。
- `app/(app)/computers/page.tsx`：listTitle 接 t("title")。

## 验证

- `bun run typecheck`：通过（0 error）。
- `bun test`：254 pass / 0 fail（43 个测试文件）。
- 真实浏览器（`./twd`，候选 = 本 worktree 热更新 dev server :3000，账号 zy-ean）：
  - water 主题成员详情页 + chat 页：中文 tab（成员详情/档案/权限/私信/提醒/工作区/应用/动态）、彩色 tab（聊天=黑底激活、任务=红、记忆=绿、文件=墨、动态=青）、成员详情字段全中文（成员 ID/电脑 ID/工作区 ID/运行时绑定/电脑/电脑状态/运行时/提供方/进程 PID/会话/工作目录）。
  - shuimo 主题同页：tab 功能色可辨认（聊天黑、任务红、记忆绿、文件墨、动态青），成员详情中文化一致。
  - dark 主题成员详情：中文 tab + 暗色底正常。

## 遗留（下一轮可选）

- `.shuimo` 第一块（globals.css:310-380，早期灰调实验稿）已是死代码，可删。
- `daemon/page.tsx`（904 行）未接 i18n 且自造布局（与 ProductShell 不一致）。
- `control/integration`、`control/taskrun-templates` 中文硬编码（en locale 破版）。
- 共享原件提取：SectionHeader / TabStrip / MetricCardGrid / 共享 ListPanel（盘点报告已列出全部重复点）。
- `components/product-create-panel.tsx` 无任何页面引用（疑似死代码）。

## 批次三：死代码清理 + task-board i18n（已实施）

**死代码清理**：
- 删除 `components/product-create-panel.tsx`（无任何页面引用，仅一个测试断言引用其源码）。
  测试断言转移到 `lib/control-plane.ts` 的 `BROWSER_API_BASE = resolvePublicApiBase(PUBLIC_RUNTIME_ENV`。
- 删除 `.shuimo` 第一块（globals.css 早期灰调松烟墨实验稿）——已被第二块（Inkframe 桌面方向）完全覆盖，是历史死代码。保留单一 `.shuimo` 块并补注释说明视觉方向。

**task-board.tsx i18n**（chat 页 tasks tab 用的旧看板）：
- `EvidenceEntryRow` evidence 类型标签复用 `tasks.evidenceType*` key（与 task-route-projection 同源），不再硬编码英文。
- `SortableTaskCard` 的 `aria-label`/`title` 用 `t("openTaskAria")`/`t("dragTaskHint")`。
- `TaskBoard` 的 `Update failed`/`Assign failed`/`Loading tasks...` 改 `t("updateFailed")`/`t("assignFailed")`/`t("loadingTasks")`。
- `TaskMemoryInline` 的 `Loading memory...` 改 `t("loadingMemory")`。
- 测试 `task-board-hydration.test.tsx` 改用 `NextIntlClientProvider` 包裹（renderToStaticMarkup 需要 messages）。
- 测试 `material-surface.test.tsx` 的 sortable card 源码正则同步到新 `aria-label={t("openTaskAria"...)}` 写法。
- 新增 `tasks.openTaskAria` key（zh-CN「拖拽或打开任务「{title}」」/ en）。

**验证**：typecheck 0 error；254 tests pass / 0 fail。

## 用户决策：daemon / control 三页面（不做 i18n 与布局重构）

以下三个页面是**测试管理用途**，**默认隐藏、不出现在 rail 图标导航上**，普通用户访问不到：
- `app/(app)/daemon/page.tsx`（904 行，Slock Control Plane / Marker Debug Workbench / Dispatch / Agent Control / API Surface）
- `app/(app)/control/integration/page.tsx`（826 行）
- `app/(app)/control/taskrun-templates/page.tsx`（359 行）

**决策**：暂不做 i18n 化与 ProductShell 布局重构。它们的中英混杂/硬编码中文不影响正式产品路径（rail 不暴露入口）。如未来转为正式功能页，再按本任务批次二的模式接入 `useTranslations` + ProductShell。

