# 前端美观优化：agent 回复可读性与整体视觉

## Goal

用户反馈当前聊天页前端"效果还是差"，要求在不改变 Inkframe 手作墨边设计语言
（干宣纸桌面 + 2px 墨边 + 直角 + 硬偏移阴影）的前提下，重点提升 **agent 回复
文本框的可看性**，顺带修整消息区其它明显不好看的元素。本地直接在 main 上实施。

## 现状问题（真实浏览器实测确认，1920px 视口 + DPR2）

已通过 kimi-webbridge 在 `http://127.0.0.1:3000/chat/dm:…` 实测，注入了一条覆盖
标题/加粗/inline code/代码块/列表/引用/表格/链接的 markdown 消息，逐项确认：

1. **代码块太"玩具"**：薄荷绿满铺饱和度偏高、无语言标签、无复制按钮、内边距
   小、代码与边框拥挤；长代码块阅读困难。
2. **引用块太吵**：整行满铺玫瑰粉，视觉重量压过正文。
3. **列表无悬挂缩进**：`list-inside` 导致换行文本顶到 bullet 下方，层级不清。
4. **表格粗糙**：表头文字居中而内容左对齐（不一致）、边框用 off-palette 的
   `--border`（浅蓝灰，spec Known Debt #3），单元格拥挤。
5. **标题层级弱**：h1-h3 只有 mb 没有 mt，标题贴着上一段，层级节奏差；
   h2 与正文大小对比不足。
6. **inline code chip 偏重**：1.5px 墨边在 0.85em 小字上显得笨。
7. （确认无需改）消息气泡 `max-width: min(100%, 72ch)` 已生效，实测 727px，
   行长在合理范围。

## Requirements

保持 spec `.trellis/spec/frontend/product-ui-style.md` 的硬约束：直角、墨边、
硬阴影、token 取色（禁止 Tailwind 色板字面量）、手作物件语言。在此之内：

1. **代码块重做**（`markdown-message.tsx` + `globals.css`）：
   - 自定义 `pre` 渲染：头部条显示语言名 + 复制按钮（复制成功有反馈）；
   - 薄荷底色降为更柔和的 tint（color-mix 与 paper 混合），墨边保留；
   - 增大内边距与行高，代码字号略降（0.85-0.875em），横向滚动保留。
2. **引用块降噪**：左侧 3-4px 玫瑰色粗竖条 + 浅玫瑰 tint 底（color-mix 降饱和），
   去掉满铺重底与硬阴影，保持墨边语言内的精致感。
3. **列表悬挂缩进**：改用 `list-outside` + 左 padding，换行文本与首行文字对齐；
   嵌套列表缩进正常。
4. **表格规整**：表头左对齐与内容一致、表头浅砂纸底（`--sand`/`--paper-deep` 系）、
   边框换 ink 系 token、单元格 padding 加大。
5. **标题节奏**：h1/h2/h3 增加段前距（mt），拉开与上文的距离；保持字号阶梯。
6. **inline code 减负**：边框降 1px、保持薄荷 chip 语义。

不做：不改气泡 72ch 宽度、不改配色 token 体系、不动三主题机制、不做侧边栏/
顶部 tab 等大范围重排（保持任务范围收敛）。

## Acceptance Criteria

- [ ] 浏览器实测截图：同一条富 markdown 消息中，代码块有语言标签+复制按钮且
      底色柔和；引用块为左竖条样式；列表换行对齐；表格表头左对齐、边框清晰；
      标题与上文有明显间距
- [ ] 复制按钮真实可用（点击后剪贴板有代码内容）且有成功反馈
- [ ] `npx tsc --noEmit` 通过
- [ ] water 默认主题验证；dark / shuimo 主题下代码块与引用块不崩（截图抽查）
- [ ] 无新增硬编码颜色（全部走 token / color-mix）

## Notes

- 实测环境：dev.sh 本地栈（前端 :3000 / 后端 :8000），kimi-webbridge
  `smallkhoj-dev` session，测试账号 twd:zy-ean（auth bridge 注入 cookie）。
- 上一次美化任务 `archive/2026-08/08-04-frontend-beautification` 做的是配色/i18n，
  本任务聚焦消息渲染，互不重叠。
