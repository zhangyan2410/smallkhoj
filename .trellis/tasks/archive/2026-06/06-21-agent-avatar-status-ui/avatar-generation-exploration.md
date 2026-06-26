# Avatar Generation Exploration

Date: 2026-06-22

This note records the post-MVP avatar generation exploration for the completed
`agent-avatar-status-ui` task. It does not change the original MVP contract:
agents still have a deterministic local fallback, runtime UI must not call AI
image generation, and humans may use URL/upload-backed avatars.

## Question

Can SmallKhoj move beyond DiceBear `croodles-neutral` and get a more polished,
East Asian / light-anime agent avatar style while keeping the runtime simple?

## Experiments

### 1. Croodles Neutral Presets

Implemented local preset support on top of DiceBear `croodles-neutral`:

- `default`
- `friendly`
- `focused`
- `debugger`
- `energetic`

The preset is selected by `member.config.avatarPreset`. Unknown preset names
fall back to `default`.

Result:

- Useful for quick deterministic variation.
- Still visually tied to Croodles' western doodle style.
- Not enough for the desired agent identity direction.

Relevant files:

- `frontend/lib/member-avatar.ts`
- `frontend/scripts/avatar-preset-preview.ts`
- `frontend/public/avatar-preview/agent-avatar-presets.html`
- `frontend/test/member-avatar.test.tsx`

Evidence:

- `evidence/REAL_agent_avatar_presets_20260622.png`
- `evidence/REAL_agent_avatar_energetic_eyes_20260622.png`

### 2. Local Croodles Extension

Added a local in-memory extension of Croodles Neutral instead of modifying
`node_modules`. The extension injects one custom eye variant:

- `smallkhojEnergetic01`

Result:

- Technically works.
- Good for simple smiling eyes.
- Complex AI-generated eyes are not worth hand-tracing into Croodles paths.
- Handwritten paths quickly lose the subtle quality of generated reference art.

Relevant files:

- `frontend/lib/smallkhoj-croodles-neutral.ts`
- `frontend/lib/member-avatar.ts`
- `frontend/test/member-avatar.test.tsx`

Evidence:

- `evidence/REAL_agent_avatar_energetic_section_20260622.png`

### 3. SmallKhoj SVG Component Pack

Created a tiny SmallKhoj-owned SVG avatar component pack. It separates the face
into inspectable parts:

- `background`
- `brows`
- `eyes`
- `nose`
- `mouth`
- `cheek`

The first pass tried three expressions:

- `energetic`
- `focused`
- `reviewer`

Result:

- The simple `energetic` expression is worth keeping.
- The more complex focused/reviewer expressions were not good enough.
- Simple hand-written SVG is useful as a lightweight fallback, not as a full
  replacement for high-quality generated image assets.

Current retained expression:

- `energetic`

Relevant files:

- `frontend/lib/smallkhoj-agent-avatar.ts`
- `frontend/test/smallkhoj-agent-avatar.test.ts`
- `frontend/scripts/avatar-preset-preview.ts`

Evidence:

- `evidence/REAL_smallkhoj_avatar_components_20260622.png`
- `evidence/REAL_smallkhoj_avatar_components_final_20260622.png`

### 4. Generated Image Asset as Agent Avatar

Used an AI-generated reference sheet from the operator, cropped the top-left
expression into a local image asset, and wired agent avatar resolution so
agents can use a system-provided image URL.

Image asset:

- `frontend/public/avatars/agents/generated-energetic-reference.png`

Runtime config shape:

```json
{
  "avatarImageUrl": "/avatars/agents/generated-energetic-reference.png"
}
```

Resolution rule:

1. If `member.kind === "agent"` and `member.config.avatarImageUrl` is set,
   use that image URL.
2. Otherwise use the deterministic generated fallback.
3. Humans still use `profile.avatarUrl` / `avatarUrl`.

Local real-data test:

- Updated the local Docker test DB member `@mini`
  (`5fe6445a-151b-4c36-8f65-764e931bb028`) with
  `config.avatarImageUrl`.
- Verified `/api/v1/members` returns the image URL.
- Verified the members page renders `mini` with
  `/avatars/agents/generated-energetic-reference.png`.

Evidence:

- `evidence/REAL_agent_avatar_image_asset_preview_20260622.png`
- `evidence/REAL_mini_agent_image_avatar_20260622.png`

## Decision

Use a two-tier avatar strategy:

### Default / Fallback

Use deterministic local generated avatars.

For now this can remain DiceBear/Croodles-based, with the simple SmallKhoj SVG
`energetic` expression preserved as a future fallback candidate.

### High-Quality Agent Identity

Use pre-generated image assets for polished agent avatars.

These images may be produced with AI tools, but only outside the runtime path.
The product should store and serve them as static/cached assets, referenced by
`config.avatarImageUrl` or a future first-class avatar metadata field.

## Recommended Product Model

Future product model:

```ts
type AgentAvatar =
  | {
      kind: "generated_svg"
      styleVersion: "croodles-neutral" | "smallkhoj-agent-v0"
      preset?: string
      seed?: string
    }
  | {
      kind: "image_asset"
      styleVersion: "smallkhoj-agent-v0"
      imageUrl: string
    }
```

Current prototype uses the lighter interim form:

```ts
member.config.avatarImageUrl
member.config.avatarPreset
```

## Boundaries

- Do not call AI image generation from the runtime UI.
- Do not expose raw DiceBear variant controls to users.
- Do not let humans upload/change agent avatars in normal creation flows.
- Treat image assets as system-generated or admin-managed.
- Keep SVG fallback simple; do not spend large effort hand-tracing complex
  generated eyes.

## Verification

Commands run during the exploration:

```bash
cd frontend
npm run avatar:preview
npx tsx --test test/*.test.ts test/*.test.tsx
npx tsc --noEmit
npm run lint
```

Latest result:

- Frontend tests: 30/30 pass.
- TypeScript: pass.
- ESLint: pass.
- WebDriver verified the preview page and the real `@mini` member page.
- `graphify update .` was run after code changes; `graph.html` was skipped by
  graphify because the graph is above the HTML visualization node limit.

## Follow-Up

1. Decide whether `avatarImageUrl` should become a documented public API field
   instead of a freeform config key.
2. Add a small admin-only flow for assigning generated image assets to agents.
3. Replace or retire the Croodles preset experiment if the product commits to
   pre-generated image assets.
4. Keep the retained `energetic` SVG expression only if it remains useful as a
   lightweight fallback.
