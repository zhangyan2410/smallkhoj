# 前端全面美化优化

## Goal

用户反馈：当前前端配色灰暗，「以前做过更鲜艳的配色，像是合丢了」；要求一次全面前端美化——恢复鲜艳配色、给更多控件着色、修复 i18n 英文残留（默认中文）、清理重复布局。直接在 main 上实施。

## 根因（调研确认）

配色「丢失」= 激活主题不对 + 部分着色规则失效，不是变量被删：

1. 三主题机制（`theme-switcher.tsx`）：localStorage `theme` = `dark | shuimo | null(=water)`，`<html>` 加 class。用户机器存的是 `shuimo`。
2. `:root`（water 默认主题）保留完整 B/C 双档六色 accent 系统（`globals.css:200-223`，源自 6ea81f3，色值取自 color-options.html，本来就鲜艳）。
3. **`.shuimo` 第二覆盖块（globals.css:388-468，Inkframe 桌面实验）把 `--accent-blue` 压成 `var(--ink)`、`--accent-purple` 压成 `--ink-soft`，六色只剩朱砂/苔绿/琥珀三个弱色相**——这是截图里 tab 灰黑、成员详情一片灰的直接原因。
4. `.sk-rail-active-{blue,rose,mint,green,purple}` 五个变体视觉完全一致（`globals.css:1796-1800`：统一墨底 + 朱砂 `::before`），rail 每 nav 的功能色配置是死代码。
5. i18n：成员详情页等存在大量硬编码英文（Member Detail / Profile / Permissions / Runtime Binding / Delete / No profile description 等），未走 `useTranslations`。
6. 布局重复：「label+value 键值卡片」「tab 栏」「Section 标题行」等模式多处手写重复。

## Requirements

1. **鲜艳回归**：默认主题全站功能色回归 B/C 双档六色；`.shuimo` 恢复六色可读性（保宣纸底+墨边签名，accent 恢复着色）。
2. **控件着色扩展**：tab 栏、rail active、徽标、键值卡片、状态点、按钮/表单等接入 accent/cat/status token；消灭整片灰色控件区；`--cat-*` 与 `--avatar-tint-*` 提亮。
3. **i18n 补全**：全站硬编码英文 UI 串走 `useTranslations`，补齐 zh-CN.json（默认 locale 中文）。
4. **布局去重**：提取共享原件（键值卡片网格、tab 栏等），重整成员详情页布局。

## Acceptance Criteria

- [ ] water 主题下 rail active 六色分明；chat tabs / 成员详情 / 任务板有明显功能色，无整片灰色区
- [ ] shuimo 主题保留墨色签名，功能色可辨认（非纯灰）
- [ ] 成员详情页全中文；tasks/computers/settings/daemon 抽查无裸英文 UI 串
- [ ] `bun run typecheck` 通过、`bun test` 全绿
- [ ] `./twd` 截图验证 water + shuimo 关键页面
