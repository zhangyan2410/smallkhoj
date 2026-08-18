# Implement: 长版 Remotion skeleton composition（Phase 1）

## Step 1: 提取主题与工具常量

- 创建 `src/lib/theme.ts`，把颜色、FPS、WIDTH、HEIGHT、`clamp`、fade helpers 移入。
- 创建 `src/lib/utils.ts`，把 `fade`、`fadeOut`、`ease` 等通用动画函数移入。
- 验证：原 `FullPromoPreview.tsx`  import 新文件后无类型错误。

## Step 2: 提取公共组件

- 创建 `src/components/PaperCard.tsx`
- 创建 `src/components/Subtitle.tsx`
- 创建 `src/components/Stamp.tsx`
- 创建 `src/components/AgentAvatar.tsx`
- 创建 `src/components/MessageBubble.tsx`
- 创建 `src/components/TaskCard.tsx`
- 创建 `src/components/ChannelFrame.tsx`
- 创建 `src/components/ScenePlaceholder.tsx`

每个组件从 `FullPromoPreview.tsx` 复制对应 JSX 并改为 import theme/utils。

## Step 3: 拆分已有 scene

把 `FullPromoPreview.tsx` 中已实现的 scene 拆成独立文件：

- `src/scenes/full/Act1BottleneckScene.tsx`
- `src/scenes/full/Act2TurningPointScene.tsx`
- `src/scenes/full/Act4AuraTeamIntroScene.tsx`
- `src/scenes/full/Act5CollaborationDemoScene.tsx`

拆分时：
- 保留原动画逻辑
- 把局部使用的 helper（如 `MouseCursor`、`FocusBadge`）就近放到 scene 文件内部或 `src/components/`
- 删除 `FullPromoPreview.tsx` 中重复定义

## Step 4: 新增占位 scene

- `src/scenes/full/Act3VisionScene.tsx`：terminal 缩小、avatar 浮出占位
- `src/scenes/full/Act6BeyondCodingScene.tsx`：5 张快闪占位卡
- `src/scenes/full/Act7ClosingScene.tsx`：logo/tagline/CTA 占位

每个占位 scene 只包含：
- 背景色
- 幕标题
- 帧范围
- TODO 注释说明 Phase 2/3/4 要替换的内容

## Step 5: 组装 LongPromoComposition

- 创建 `src/scenes/full/LongPromoComposition.tsx`
- 用 7 个 `Sequence` 组合七幕
- 总帧数 6300
- 每个 Sequence 引用对应 scene

## Step 6: 更新 index.tsx

- 把 `FullPromoPreview` component 指向 `LongPromoComposition`
- 保持其他 composition 不变
- 删除 FullPromoPreview 中已拆走的内联 exports（如 `ContinuousAcceptSample` 等）若不再需要

## Step 7: 类型检查与渲染验证

- 在 `remotion/aura-team-promo/` 运行 `npx tsc --noEmit`
- 运行 `npm run preview-full` 或 `npm run dev` 快速 scrub 时间轴
- 检查 0/900/1200/1650/2100/5100/5700/6300 边界可见标题

## Step 8: 更新文档与 Slock 状态

- 在 `docs/05-full-video-implementation-plan.md` 第 7 节 Phase 1 处标记完成
- 发送 Slock 消息汇报交付
- 把 Slock task #7 更新为 in_review

## Validation Commands

```bash
cd /Users/code/project/smallkhoj/remotion/aura-team-promo
npx tsc --noEmit
npm run dev
```

## Review Gates

- [ ] TypeScript 无错误
- [ ] Remotion Studio 可看到 6300 帧 `FullPromoPreview`
- [ ] 七幕边界标题清晰可见
- [ ] 现有 proof compositions 不受影响
