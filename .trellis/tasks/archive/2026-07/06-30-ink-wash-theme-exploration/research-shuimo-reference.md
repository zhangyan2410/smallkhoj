# Research: 水墨主题参考与当前实现问题分析

> 调研日期：2026-07-01
> 状态：参考素材（pending 后续风格大重构）。第一版水墨主题已合并 main（commit
> f886567），但实测发现质感不足，用户判定"只是调了背景色"。本文档汇总调研结论，
> 供后续重构复用。

---

## 一、当前实现的问题（twd 实测 water vs shuimo 三页截图）

用 `./twd` 在浏览器实测 computers/settings/chat 三页，对比 water 与 shuimo 主题，
确认三个问题：

### 问题 1：最左侧 rail 没有随主题变化（根因已定位）
- **现象**：shuimo 主题下，最左侧 icon rail 仍是水材质图，跟 water 一模一样。
- **根因**：`globals.css:639-645` 的 `.sk-rail-bg` 用的是 **hardcoded 位图**
  `url("/rail-water-texture.png")`，完全不走 token。`.shuimo` 只改 CSS 变量，
  rail 的 CSS 规则没读这些变量 → token 覆盖对 rail 无效。
- **补充**：rail 的 active 项（`sk-rail-active-*`，globals.css:682-707）**是**
  token 驱动的，会随 `.shuimo` 正确变墨阶。问题仅限 rail 底图背景。
- **解法方向**：rail 改 token 驱动（`var(--rail-bg)`）。water 的 token 值 = 原
  PNG（零回归）；shuimo 的 token 值 = 墨色 + 纹理。

### 问题 2：没有水墨质感
- **现象**：`.shuimo` 的表面全是纯 `oklch` 实色，平的。缺宣纸纹理、墨色渐染。
- **解法方向**：SVG noise 滤镜（feTurbulence）生成生宣纹理 + 墨色渐染表面。

### 问题 3：层次太"灰白"，缺墨韵
- **现象**：生宣白底 + 松烟墨字之间缺乏过渡，像"浅灰主题"而非"纸上的墨"。
- **解法方向**：顶部墨染渐变 + 朱砂印章强化 active 态。

---

## 二、shuimo-ui 参考库调研（核心参考）

[shuimo-ui](https://github.com/shuimo-design/shuimo-ui)（`@shuimo-design/shuimo-ui`，
Vue 组件库，官网 [shuimo.design](https://shuimo.design/)）是市面上少数成型的
水墨风 UI 库。另有 React 版 `shuimo-ui-react` 与社区 `valaxy-theme-shuimo`。

### 关键认知（修正了一个错误假设）
**shuimo-ui 本身其实是「纯色 + 硬直线」**——它的水墨感主要来自：
1. **克制的色板**（低饱和的炭/灰/矿物色，无鲜艳色）
2. **毛笔笔触装饰**（标题/插画里的手绘有机线条，非组件边框本身）
3. **朱砂印章**作为强调点缀

它的组件表面**没有** SVG 噪点纹理或墨色渐变填充——是纯色。所以如果完全照搬
shuimo-ui，质感仍偏"平"。用户要"更像水墨"，因此我们决定**比 shuimo-ui 走得更远**
：用 SVG noise 加生宣纹理 + 墨色渐染。

### shuimo-ui 色板（像素级提取，hex 近似）
| 用途 | hex 近似 | 说明 |
|---|---|---|
| 宣纸底（卡片/页面） | `#f0f0f0` | 米白偏暖，非纯白 |
| 浓墨文字（最深） | `#2d2d2d` | 深炭，非浏览器纯黑 |
| 次要灰字 | `#666666` | |
| 朱砂红（印章/强调） | `#b22222` | 低饱和中国红 |
| 石青/矿物蓝绿 | `#008b8b` | 低饱和 |
| 板岩 | `#2f4f4f` | |
| 边框色 | 炭灰 | 硬直线，非手绘 |

**与我们现有 `.shuimo` 的对照**：松烟墨 `oklch(0.20 0.015 260)` ≈ 深炭 ✓；
生宣白 `oklch(0.96 0.006 90)` ≈ 米白 ✓。**色板方向正确，差距在质感不在色值。**

### 技术实现线索
- shuimo-ui 用 CSS 变量做 theme token（release notes 提到 `rice-paper` 组件/概念，
  修过"rice-paper 中错误的高度 css 变量"）。
- 官网组件可在 DevTools 直接看实现（建议后续重构时实地查看其 `background-image`
  / SVG filter 用法）。

---

## 三、SVG feTurbulence 生宣纹理方案（已选定的纹理技术）

成熟方案，参考资料：
- [SVG feTurbulence 深入（张鑫旭）](https://www.zhangxinxu.com/wordpress/2020/10/svg-feturbulence/)
- [SVG Filter Effects: Creating Texture (Codrops)](https://tympanus.net/codrops/2019/02/19/svg-filter-effects-creating-texture-with-feturbulence/)
- [nnnoise 在线 SVG 噪点生成器](https://fffuel.co/nnnoise/)

### 实现要点
- `feTurbulence`(type=fractalNoise, baseFrequency 高频) + `feColorMatrix`(降 alpha)
  生成纸纹颗粒。
- 作为 `background-image: url("data:image/svg+xml,...")` 内联，浏览器当图片缓存，
  不每帧重算，无外部文件。
- alpha 锁 **0.03-0.05**（极淡，守 R5 实用优先，不喧宾夺主）。
- 示例 data-URI 结构：
  ```
  --paper-noise: url("data:image/svg+xml,%3Csvg ...%3E%3Cfilter id='n'%3E
    %3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E
    %3CfeColorMatrix values='0 0 0 0 0.15  0 0 0 0 0.13  0 0 0 0 0.1  0 0 0 0.04 0'/%3E
    %3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  ```

---

## 四、当前 .shuimo token 覆盖清单（第一版，已合并 main）

`.shuimo {}` 块（globals.css:289+）的重定义情况，供重构复用：

| 类别 | 重定义? | 说明 |
|---|---|---|
| `--background/--sand-*/--card/--paper/--sidebar*` | ✅ | 生宣白系，明度分层 |
| `--foreground/--paper-ink/--sand-ink/--sand-muted/--muted-foreground` | ✅ | 松烟墨文字 |
| `--ink/--sand-border/--border/--input` | ✅ | 松烟墨边框（`oklch(0.20 0.015 260)`） |
| `--accent-*`（6 色 + -fg/-soft/-soft-fg） | ✅ | 压墨阶，唯独 `-rose` 保留朱砂做印章 |
| `--primary/--secondary/--muted/--accent(--foreground)` | ✅ | 跟随墨阶 |
| `--success/--warning/--info/--danger`(+/-fg) | ❌ | 继承 water（点缀，含 info 蓝） |
| `--cat-*`(+/-fg) | ❌ | 继承 water（点缀） |
| `--avatar-tint-*/--agent-color-*` | ❌ | 继承 water（点缀） |

**主题边界定论（PRD R9）**：水墨骨架（背景/文字/边框/nav-tab 选中/主按钮）走
墨阶 + 朱砂印章；色彩点缀（头像/@提及/category dot/status badge）保留 water 色系。

---

## 五、已实现的基础设施（第一版，零回归安全）

这些是已经合并 main、且**与质感无关**的基础机制，后续重构可直接复用：

1. **三主题切换机制**：`<html>` 上 `.dark` / `.shuimo` 双 class，water = 无 class。
   `localStorage.theme` 扩为 `'dark' | 'shuimo' | null`。layout.tsx inline 脚本
   （beforeInteractive）识别三值，无闪烁。
2. **ThemeSwitcher 组件**（`components/theme-switcher.tsx`）：自定义客户端组件，
   `useSyncExternalStore` 保证 hydration 安全。位于 `/settings`「外观」Card。
3. **i18n 键**：`settings.appearance.{label,water,dark,shuimo}` + `settings.title/
   description`（en/zh-CN）。
4. **dark 主题**：原本是死代码（无 UI 切到它），现已可选（切换器里能选）。CSS 未动。

---

## 六、后续大重构的待办（等用户新素材）

用户表示"找到了一个更好的东西，会涉及前端风格的巨大重构"，稍后提供。本调研文档
作为重构的参考底料。重构时需重新评估：
- 色板是否要换（用户的新素材可能带来新色板）
- 纹理方案（SVG noise vs 新素材自带的纹理）
- rail 的 token 化（无论重构方向如何，rail 不随主题变的 bug 都要修）
- 三主题机制是否保留（基础设施层，大概率复用）

---

## 参考链接
- [shuimo-ui (GitHub)](https://github.com/shuimo-design/shuimo-ui)
- [shuimo.design 官网](https://shuimo.design/)
- [shuimo-ui-react](https://github.com/shuimo-design/shuimo-ui-react)
- [SVG feTurbulence 教程（张鑫旭）](https://www.zhangxinxu.com/wordpress/2020/10/svg-feturbulence/)
- [SVG Filter Texture（Codrops）](https://tympanus.net/codrops/2019/02/19/svg-filter-effects-creating-texture-with-feturbulence/)
- [nnnoise SVG 噪点生成器](https://fffuel.co/nnnoise/)
