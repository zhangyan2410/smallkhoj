# Explore switchable Shui-mo ink theme

## Goal

为 SmallKhoj 增加一套可切换的「水墨（Shui-mo）」主题，作为现有「水与沙 /
手作墨边」风格之外的**第三主题**。不替换、不覆盖现有 water 主题与 dark
主题；三套主题并存，用户可在设置页自由切换并持久化。

> 本 PRD 经 2026-06-30 design grilling 重写，以讨论定论为准，覆盖早期
> agent 生成的草稿描述。

## Requirements

- **R1: 保留现有风格。** water（水与沙 / 手作墨边，默认）与 dark（深海蓝暗
  色）两套主题必须保持可用且零回归。shuimo 是纯新增，不改 `:root` 与
  `.dark` 任何 token 值。
- **R2: 显式主题切换。** 三套主题通过 `/settings` 页「外观 / Appearance」
  Card 里的真实切换器选择，不是隐藏 CSS fallback 或一次性替换。
- **R3: 持久化。** 复用现有 `localStorage.theme`，取值从 `'dark' | null`
  扩展为 `'dark' | 'shuimo' | null`（null = water）。reload 后保持。hydration
  安全（先渲染默认 water，挂载后再读 localStorage，避免闪烁/不一致）。
- **R4: 水墨骨架 = 松烟墨 + 朱砂印章，不是黑白。** 骨架层（背景、文字、
  边框、阴影、nav/tab 选中态、主按钮）使用**松烟墨中性灰黑**（几乎无色相，
  例如 `oklch(0.20 0.015 260)`），不用蓝黑、不用纯灰阶。**朱砂红仅作「选中
  印章」**（当前 nav/tab 选中项的强调点），不大面积填充。背景为生宣白（偏白
  微黄），靠明度分层（rail 深 → 主区 → 卡片 → 气泡）。
- **R5: 实用优先。** 应用仍是工作工具；水墨材质语言服务扫描与操作，不做
  装饰性泼墨。
- **R6: 保留结构语言。** 2px 方角墨边 + 硬偏移阴影保留；但边框色用松烟墨
  （区别于 water/dark 的蓝灰墨）。表面是生宣/淡墨薄染，非通用灰阶 UI。
- **R7: 真实 app 表面可用。** settings（切换器）、chat（密集气泡）、members
  （agent 列表 + 状态点）等页面在 shuimo 下仍可读可操作。
- **R8: 不丢主题。** 三主题可循环切换且 reload 持久化；water/dark 零回归。
  lint 与 typecheck 通过即视为机制层达标；视觉对比由人验收（截图对 LLM 无
  判断价值，不作为强制证据）。
- **R9: 点缀边界。** 水墨骨架走墨阶 + 朱砂印章；以下元素**保留 water 色系
  作为点缀**，不压墨：头像底色（`--avatar-tint-*`）、@提及高亮、category
  dot（`--cat-*`）、status badge（`--success/--warning/--danger/--info`，含
  info 蓝）、agent 类型标签、任务优先级标签。

## Design Intent（水墨骨架）

- 生宣白底（偏白微黄），非纯白；rail/侧栏最深，靠明度分层。
- 松烟墨文字（中性灰黑、几乎无色相），非浏览器纯黑、非蓝黑。
- 分层靠 token 明度差异，**零位图纹理**（rail 也用纯墨色填充，不生成水墨
  png）。
- nav/tab 选中 = 浓墨填充 + 白字 + 朱砂印章；不再 chat=蓝 tasks=玫红。
- 朱砂红仅做选中印章，不扩展到确认/危险（避免与 danger 红混淆）。

## Forbidden

- 纯黑白 / 通用 dark mode / 去饱和灰阶主题 / 缺 CSS fallback。
- 蓝黑墨、mineral blue-green 强调色（与「水墨无蓝绿」冲突）。
- 装饰泼墨、SVG 涂鸦、对角条纹、渐变色块、玻璃面板、圆角卡片重设计。
- 把 status/category/avatar 点缀色也压成墨阶（会丢识别度，违背 R9）。

## Acceptance Criteria

- [ ] water 与 dark 主题仍可渲染且可选，且 `:root`/`.dark` token 零改动。
- [ ] shuimo 可通过 settings「外观」Card 选择。
- [ ] 主题选择 reload 后保持（localStorage.theme 3 值）。
- [ ] shuimo 用刻意的水墨调色板：生宣白底、松烟墨文字/边框、明度分层表面、
      朱砂仅做选中印章；点缀色保留 water 色系。
- [ ] shuimo 不是纯灰阶 / 通用暗色 / 缺 token fallback。
- [ ] 复用现有 token/组件系统；不为每页 fork route-local 视觉原语。
- [ ] nav/tab 选中在 shuimo 下为浓墨 + 朱砂印章（统一，不再多色）。
- [ ] `pnpm lint` 与 typecheck 通过；三主题可循环切换且 reload 持久化。

## Implementation Notes

- 在 `<html>` 上加 `.shuimo` class（与现有 `.dark` 同模式）；water = 不加任何
  class。layout 的 `beforeInteractive` inline 脚本从识别 2 值扩为 3 值。
- `.shuimo {}` 块只重定义骨架 token（surface/ink/text/`--accent-*`），**不**
  重定义 `--success/--warning/--info/--danger/--cat-*/--avatar-tint-*`（继承
  water 做点缀）。
- `--accent-*` 在 `.shuimo` 下压成墨阶变体（solid=浓墨+白字，soft=淡墨+深
  字），唯独 `--accent-rose` 保留朱砂做印章。
- 切换器 = 自定义客户端组件 `ThemeSwitcher`（~40 行，零依赖），不引入
  next-themes（其始终加 class 的模型与「water=无类」别扭）。
- rail 用纯墨色 token 填充，不生成水墨位图。
