# Avatar Design Agent Brief

Use this brief when asking another agent to work on SmallKhoj avatar design.

## Prompt To Give An Agent

Design or implement SmallKhoj avatar work using the avatar object language in:

```text
/Users/code/project/smallkhoj-inkframe-object-ui/.trellis/tasks/06-30-ink-wash-theme-exploration/avatar-design-agent-brief.md
```

The default agent avatar frame is option B, `identity-thin`, from:

```text
/Users/code/project/smallkhoj-inkframe-object-ui/.trellis/tasks/06-30-ink-wash-theme-exploration/evidence/avatar-border-options.html
```

Core rules:

- Use `AvatarObject / 头像预制体` as the shared prefab for agent and human avatars.
- Agent and human are different instances/variants of the same prefab, not
  separate unrelated controls.
- Default agent frame is `identity-thin` / 轻身份框.
- Right-top corner is reserved for the status dot. Do not cover it.
- A paper-frame fold may be explored on the left-top corner, not the right-top
  status corner.
- Do not put a cinnabar stamp on avatars. Review/approval stamps are separate
  `ReviewStamp` objects.
- Agent avatar content should use generated/avatar face art, not human-style
  initials by default.
- Human avatar content may use uploaded image or initials fallback.
- Avoid "square frame + inner blue ball" and avoid "square frame + pasted round
  face blob" as the default target.
- Agent face art should fill or integrate with the avatar tile.

Relevant source and docs:

```text
/Users/code/project/smallkhoj-inkframe-object-ui/frontend/components/inkframe-object-ui.tsx
/Users/code/project/smallkhoj-inkframe-object-ui/frontend/components/member-avatar.tsx
/Users/code/project/smallkhoj-inkframe-object-ui/frontend/components/ui/avatar.tsx
/Users/code/project/smallkhoj-inkframe-object-ui/frontend/lib/member-avatar.ts
/Users/code/project/smallkhoj-inkframe-object-ui/.trellis/tasks/06-30-ink-wash-theme-exploration/prd.md
/Users/code/project/smallkhoj-inkframe-object-ui/.trellis/tasks/06-30-ink-wash-theme-exploration/object-language-alignment.md
/Users/code/project/smallkhoj-inkframe-object-ui/.trellis/tasks/06-30-ink-wash-theme-exploration/visual-language-map.md
```

## Current Decision

Default:

```text
agent identity frame = identity-thin
right-top = status dot
left-top = optional paper-frame fold
avatar content = generated agent face, integrated with tile
```

Do not default to:

```text
cinnabar stamp on avatar
red corner mark on status corner
blue circular initials ball inside a square frame
round face blob pasted inside a square frame
agent shown as initials-only
```
