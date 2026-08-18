# Design: 长版 Remotion skeleton composition（Phase 1）

## Boundaries

- 目标包：`remotion/aura-team-promo/`
- 不动已有 proof：`src/scenes/OpeningScene.tsx`、`src/scenes/SmallKhojTeamScene.tsx`、`src/scenes/CTAScene.tsx`
- 不引入新依赖，只使用已有 `@remotion/cli`、`remotion`、React
- Phase 1 只输出 skeleton + 公共组件提取，不精修动画

## Data Flow

```
src/index.tsx
  └─ FullPromoPreview composition (6300 frames)
       └─ src/scenes/full/LongPromoComposition.tsx
            ├─ Act1BottleneckScene        (0-900)
            ├─ Act2TurningPointScene      (900-1200)
            ├─ Act3VisionScene            (1200-1650)  // 占位
            ├─ Act4AuraTeamIntroScene     (1650-2100)
            ├─ Act5CollaborationDemoScene (2100-5100)
            ├─ Act6BeyondCodingScene      (5100-5700)  // 占位
            └─ Act7ClosingScene           (5700-6300)  // 占位
```

## Contracts

### Scene 组件接口

每个 scene 都是独立 React 组件，接收 `style` / `className` 可选，内部使用 `useCurrentFrame()` 计算局部帧。

```tsx
export const ActXBriefScene: React.FC = () => {
  const frame = useCurrentFrame();
  // 局部帧 = frame - sequence.from
  // 但 Sequence 会自动裁剪，组件内部可直接用 useCurrentFrame() 获取相对帧
  return <AbsoluteFill>...</AbsoluteFill>;
};
```

### 公共组件

放到 `src/components/`：

| 组件 | 来源 | 说明 |
|---|---|---|
| `PaperCard` | `FullPromoPreview.tsx` | 纸卡容器 |
| `Subtitle` | `FullPromoPreview.tsx` | 底部字幕 |
| `Stamp` | `FullPromoPreview.tsx` | 彩色标签 |
| `AgentAvatar` | `FullPromoPreview.tsx` | 带在线点头像 |
| `MessageBubble` | `FullPromoPreview.tsx` | 消息气泡 |
| `TaskCard` | `FullPromoPreview.tsx` | 任务卡片 |
| `ChannelFrame` | `FullPromoPreview.tsx` | smallkhoj 风格工作台框架 |
| `ScenePlaceholder` | 新增 | 幕占位色块+标题 |

### 颜色/常量

提取 `src/lib/theme.ts`：

```ts
export const ink = '#1d1a12';
export const paper = '#f3eedf';
export const paperLight = '#fffaf0';
export const blue = '#73c6d4';
export const pink = '#e58aa3';
export const green = '#9fc36a';
export const purple = '#b5addb';
export const yellow = '#e8c85b';
export const muted = '#706855';
export const dark = '#0a0a0a';
```

## Trade-offs

1. **拆分到多文件 vs. 单文件**：把 `FullPromoPreview.tsx` 拆分。单文件 2000+ 行难以 review，拆分后每幕独立。
2. **占位 scene 用纯色 vs. 简单图形**：纯色 + 标题足够 Phase 1 review，避免过早投入动画。
3. **公共组件一次性全抽 vs. 按需**：Phase 1 把已重复出现的样式抽成组件，后续 scene 精修时直接复用。

## Compatibility

- 保持 `OpeningPreview` / `AuraTeamPromo` / `SmallKhojTeamPreview` 等现有 composition ID 和时长不变。
- 已有渲染命令（`preview-30s`、`preview-full`）继续可用。
- 新增或修改的 scene 不依赖未采集素材。

## Rollback

- 若拆分后某 scene 行为异常，可临时在 `LongPromoComposition.tsx` 中把该 `Sequence` 替换为 `<AbsoluteFill style={{backgroundColor}} />`。
- 保留 git 历史，随时可回退到单文件 `FullPromoPreview.tsx`。
