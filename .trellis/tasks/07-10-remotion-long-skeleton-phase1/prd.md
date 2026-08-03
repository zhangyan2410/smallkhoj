# 长版 Remotion skeleton composition（Phase 1）

## Goal

为 AuraTeam 2-3 分钟完整版宣传片建立 Remotion Phase 1 skeleton composition：
- 锁定 6300 帧（3:30 @ 30fps）长版 composition 结构
- 按七幕时间轴切分 Sequence，每幕有占位色块/标题/责任人
- 复用已有 v4 proof 模块作为真实插片，同时暴露缺口
- 让团队能在 Remotion Studio 里直接 scrub 3:30 节奏

## Requirements

1. Composition 规格
   - 新增/更新 `FullPromoPreview` composition，总时长 6300 帧
   - 源尺寸 3840×2160，fps 30
   - 在 `src/index.tsx` 中注册并保持 `OpeningPreview` 等 proof composition 不被覆盖

2. 七幕骨架
   - 第一幕·瓶颈：0-900 帧
   - 第二幕·转折：900-1200 帧
   - 第三幕·愿景：1200-1650 帧
   - 第四幕·AuraTeam 登场：1650-2100 帧
   - 第五幕·协作演示：2100-5100 帧
   - 第六幕·不止编码：5100-5700 帧
   - 第七幕·收尾：5700-6300 帧

3. 每幕至少包含
   - 一个 `Sequence` 占位组件
   - 纯色/渐变背景 + 幕标题 + 帧范围字幕
   - 对已有真实 scene 的引用说明或 TODO 注释

4. 复用与解耦
   - 把 `FullPromoPreview.tsx` 中已实现的 scene 拆到 `src/scenes/full/` 下独立文件
   - 公共组件（`PaperCard`、`Subtitle`、`Avatar`、`TaskCard`、`MessageBubble` 等）抽到 `src/components/`
   - 保持现有 `OpeningScene.tsx`、`SmallKhojTeamScene.tsx`、`CTAScene.tsx` 不变

5. 素材与缺口标注
   - 第五幕引用已采集的真实 UI 截图目录
   - 第六幕用 5 张快闪占位卡（coding / design / copy / video / data）
   - 对尚未实现 scene 加 `TODO(scene): Phase X` 注释

## Acceptance Criteria

- [ ] `npm run dev` 能在 Remotion Studio 看到 `FullPromoPreview` 6300 帧 composition
- [ ] 拖动时间轴到 0/900/1200/1650/2100/5100/5700/6300 能区分七幕边界
- [ ] 每幕有可见标题和背景色，不是黑屏
- [ ] 已有真实 scene（Bottleneck / TurningPoint / AuraTeamIntro / CollaborationDemo）被正确引用或拆分后引用
- [ ] 公共组件提取后，原文件不再包含重复样式定义
- [ ] `render` / `preview-full` 脚本不报错（1080p scale=0.5 即可）
- [ ] 更新 `docs/05-full-video-implementation-plan.md` 中 Phase 1 状态为完成，并标注已落盘文件

## Notes

-  Phase 1 不求动画精美，只求结构清晰、边界清楚、可 review。
-  详细七幕时间轴和关键帧见 `remotion/aura-team-promo/docs/05-full-video-implementation-plan.md`。
-  Slock task #7 已 claim，完成后更新为 in_review。
