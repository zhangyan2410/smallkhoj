# DiceBear Customization Notes

## Current Decision

SmallKhoj uses DiceBear `croodles-neutral` for system-generated agent avatars.

Runtime UI does not call DiceBear's hosted API and does not call any AI image generation service. The frontend uses local packages:

- `@dicebear/core`
- `@dicebear/styles`

The generated SVG is converted to a `data:image/svg+xml` URI and cached in-process by seed.

## Implemented Options

The current implementation wraps `croodles-neutral` in a DiceBear `Style` and uses these stable options:

```ts
export const AGENT_AVATAR_STYLE = "croodles-neutral"
export const AGENT_AVATAR_OPTIONS = {
  backgroundColor: ["e0f2fe", "eef2ff", "dcfce7", "fef3c7"],
  borderRadius: 12,
  scale: 1,
}
```

This gives us a SmallKhoj-leaning cyan/indigo/green/amber palette while keeping the base Croodles Neutral drawing system.

## What Croodles Neutral Supports

Verified with DiceBear v10 `OptionsDescriptor` against `@dicebear/styles/croodles-neutral.json`.

Core options:

- `seed`
- `size`
- `idRandomization`
- `title`
- `flip`
- `scale`
- `borderRadius`
- `rotate`
- `translateX`
- `translateY`

Croodles-specific options:

- `eyesVariant`: `variant01` through `variant16`
- `eyesProbability`
- `mouthVariant`: `variant01` through `variant18`
- `mouthProbability`
- `noseVariant`: `variant01` through `variant09`
- `noseProbability`

Color options:

- `backgroundColor`
- `backgroundColorFill`: `solid`, `linear`, `radial`
- `backgroundColorFillStops`
- `backgroundColorAngle`
- `eyepatchColor`
- `eyepatchColorFill`
- `eyepatchColorFillStops`
- `eyepatchColorAngle`
- `glassesColor`
- `glassesColorFill`
- `glassesColorFillStops`
- `glassesColorAngle`

## Useful Next Experiments

1. Constrain `eyesVariant`, `mouthVariant`, and `noseVariant` to a curated subset so agents feel more consistent.
2. Try `backgroundColorFill: ["linear"]` with two-color palettes for richer but still calm avatars.
3. Add role-based palettes later:
   - debugger: cyan/amber
   - reviewer: indigo/sky
   - browser operator: sky/lime
   - runtime keeper: emerald/slate
4. If Croodles Neutral cannot reach the desired anime style, use AI-generated references to design a SmallKhoj-owned avatar pack, but keep runtime display as static cached assets.

## Post-MVP Exploration

See `avatar-generation-exploration.md` for the 2026-06-22 follow-up experiment.

Summary:

- DiceBear `croodles-neutral` presets are technically useful but not enough for the desired SmallKhoj agent identity.
- A local Croodles extension can add simple SVG variants, but complex AI-generated anime-style eyes are not worth hand-tracing.
- The best direction is a two-tier system:
  - deterministic local SVG/DiceBear fallback for default small avatars;
  - pre-generated image assets for polished agent identity.
- The prototype supports `member.config.avatarImageUrl` for agents and verified it on the local `@mini` member.

## Boundary

Do not expose DiceBear variant controls to users in this task. Agent avatars are system-generated. Human avatars can use URL/upload-backed images.
