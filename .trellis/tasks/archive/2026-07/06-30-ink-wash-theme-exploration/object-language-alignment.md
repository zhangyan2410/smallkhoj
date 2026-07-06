# Object Language Alignment Notes

This file records the shared language from the live design discussion. It is not
a final visual spec. It is the conversation checkpoint that keeps the product
owner and future agents aligned while the object-desk UI keeps evolving.

## Core Problem We Identified

The current direction is right: SmallKhoj should feel like a working desk with
paper, tickets, evidence sheets, notes, stamps, and tool bases.

The current weakness is that too many elements have the same visual strength:

- 2px ink border
- square paper surface
- hard shadow
- similar paper background

That makes different semantic levels look identical. A message paper, task
ticket, evidence sheet, memory note, runtime binding panel, and individual field
can all read as the same kind of object. The user then cannot describe a change
precisely, and an agent cannot know which collection should change.

The fix is not to abandon the object-desk style. The fix is to name and separate
the object layers.

## Layer Names

Use these names when discussing changes.

| Layer | Chinese name | Role | Border / motion rule |
|---|---|---|---|
| `Workbench` | 工作桌 | page environment / xuan-paper desk | no border, no hover |
| `Sheet` | 工作纸面 | large page/list/detail surface | weak or structural boundary, no hover |
| `SidebarEntityItem` | 左侧列表实体项 | clickable/selectable row in the left sidebar | strong border, hover/selected allowed; lift only if reorderable |
| `ContentObject` | 内容对象 | main readable object in the work area | strong identity, but variants must differ |
| `BindingLedger` | 绑定账页 / 登记账 | grouped runtime/computer binding information | one object boundary; internal fields are not cards |
| `FieldMark` | 字段标注 / 字段账本项 | label-value information inside a parent object | weak line/ruling; no hard shadow; no hover lift |
| `InlineToken` | 行内标记 | compact status/runtime/type tags | small border or local mark only |
| `PreferenceControl` | 偏好设置项 | user-level preferences such as language/theme | belongs in settings; not persistent page chrome |

## Global Chrome vs Settings

Language switching is a user preference, not a primary workbench action.

The visible language selector shown as a large bordered control in page chrome
should move into `settings`. In object-language terms:

```text
LanguageSwitcher -> PreferenceControl / 偏好设置项
```

It should be aligned with other settings fields rather than treated as a loose
desktop object, message tool, or page-level toolbar control.

Reason:

- switching language affects the whole product, but it is rarely part of the
  current task flow;
- a persistent bordered language control competes with the workbench objects;
- settings is the right place for stable user preferences such as language,
  appearance, provider defaults, and notification behavior.

## Runtime Binding

### What Real Object Is It?

`Runtime Binding` should be a **binding ledger sheet**:

> a registration page or equipment checkout ledger placed on the workbench,
> showing which computer/tool base is bound to which runtime/session.

Good Chinese names:

- `绑定账页`
- `运行绑定账本`
- `设备登记页`
- `工位绑定单`

Recommended product-language name:

```text
BindingLedger / 绑定账页
```

It is not a stack of six independent cards.

### Why This Fits

Runtime Binding is not the runtime itself and not the computer itself. It is the
relationship between things:

```text
computer -> runtime -> provider -> pid -> session
```

That relationship feels more like a ledger or registration sheet than a ticket,
note, evidence sheet, or message.

### Visual Rule

`BindingLedger` may have one clear object boundary.

Inside it, each field is a `FieldMark`, not a `ContentObject`.

Wrong reading:

```text
Runtime Binding card
  computer card
  computer status card
  runtime card
  provider card
  pid card
  session card
```

Correct reading:

```text
BindingLedger / 绑定账页
  computer: integration-gate-mac
  computer status: offline
  runtime: claude_code
  provider: MiniMax
  pid: none
  session: a5d09bb1
```

## Border Strength Rules

Use this table to decide whether a collection needs a strong 2px ink border.

| Collection | Strong border? | Reason |
|---|---:|---|
| `SidebarEntityItem` | yes | clickable/selectable left-side entity |
| `ContentObject` | usually yes | primary object on the work surface |
| `BindingLedger` | one outer boundary | grouped relation sheet; internal fields stay weak |
| `FieldMark` | no strong object border | label/value marks written on a parent sheet |
| `InlineToken` | small/local only | status/type tag, not a full object |
| `Sheet` | weak/structural only | page-level surface, should not fight contents |
| `Workbench` | no | environmental background |

## Motion Semantics

Motion is part of the product language, not decoration.

Core rule:

```text
If hover makes an object move, lift, drift, or float, the object should be movable.
```

This creates a user contract:

- hover color/border change = interactive or selectable;
- hover paper-grain, ink-weight, or shadow-color change = inspectable or clickable;
- hover lift/offset/float = draggable, reorderable, movable, or physically liftable;
- no motion = stable reading surface or static field.

In other words, not every hover state is motion. A clickable row may still change
border, ink weight, or background on hover. But if it visually rises from the
desk, the user should be able to move it or understand why it is being lifted.

### Drop Target Rule

If an object can move, the interface must also show where it can move.

Movable objects need one of these destination signals:

- a visible slot / empty landing place;
- a highlighted drop zone while dragging;
- a reordered list gap;
- a target tray / side area;
- a ghost preview of the new position.

Never make an object lift on hover without giving the user a destination model.

### Visual + Motion Contract

This rule is intentional enough to become a naming convention:

```text
motion on hover means the object can change place.
```

If an object only opens, selects, expands, copies, or navigates, it should not
drift away from its resting place. It can still react through ink weight,
surface tone, focus outline, stamp pressure, or a tighter shadow.

If an object visually moves on hover, the product must answer two questions:

- what movement is allowed: drag, reorder, attach, place into a tray, move
  across task states, or lift into detail;
- where it can go: slot, column, tray, reordered gap, attachment target, or
  review surface.

So the motion vocabulary is:

| Motion cue | User meaning | Required destination cue |
|---|---|---|
| ink/border/background reacts | selectable/clickable | none beyond focus/active state |
| tiny stamp press | action/approval feedback | resulting state mark |
| paper lifts, drifts, tilts, or floats | movable/liftable object | slot, drop zone, gap, tray, or ghost preview |
| object slides while dragging | actively moving | live target highlight |
| object settles/fades | completed/archived/fixed | stable final place |

### Motion By Layer

| Layer | Hover feedback | Hover motion? | Why |
|---|---|---:|---|
| `Workbench` | none | no | background is not an object |
| `Sheet` | none or subtle focus | no | stable reading surface |
| `SidebarEntityItem` | border/background/selection feedback | only if reorderable | normal sidebar rows are selectable, not movable |
| `ContentObject` | local hover feedback | only if draggable/liftable | evidence/task/message objects may become movable later |
| `BindingLedger` | none or focus outline | no | a ledger is read/edited, not moved as a sheet by default |
| `FieldMark` | field focus only | no | fields are written marks, not loose objects |
| `InlineToken` | subtle hover if clickable | no | chips are labels/actions, not physical sheets |

### Current Implication

Some existing hover lifts are acceptable as experiments, but the target rule is:

- `EvidenceSurface` may lift if it represents a proof sheet that can be opened,
  attached, or moved to a review/trace area.
- `TaskMaterialSurface` should lift only where task cards are reorderable or
  movable across states.
- `SidebarEntityItem` should not use strong lift unless the list supports
  reordering; selection hover should be border/background feedback.
- `ObjectField` / `FieldMark` should not lift.

This rule helps users learn the workspace: moving visuals mean movable objects,
and movable objects show possible destinations.

## ContentObject Variants

These may all be “paper-like,” but they should not be identical.

| Object | Real object | Difference that should eventually show |
|---|---|---|
| `MessagePaper` | message slip / readable sheet | conversational, compact, short messages may tilt |
| `TaskMaterialSurface` | task ticket / docket | lifecycle material state, assignee/meta alignment |
| `EvidenceSurface` | proof sheet | source/type labels, attached proof feel; hover lift only with an open/move target |
| `MemoryFixedNote` | fixed note / pressed note | candidate vs fixed state; fixed can fade or look pressed |
| `TaskTicket` | small ticket link | compact inline task reference, not a full task board |

Current implementation may still make these too similar. That is acceptable
while the system is being extracted, but the target is clear: same material
family, different object species.

## SidebarEntityItem

The user described these as:

> 左侧侧边栏成员：一个框，框里有信息。

We refined that into:

```text
SidebarEntityItem / 左侧列表实体项
```

This is a base prefab/class for left-side selectable entities.

Subtypes:

- `MemberItem`
- `ComputerItem`
- `ChannelItem`
- `TaskItem` if tasks appear in a left-side list

Shared behavior:

- strong border
- hover selection feedback through ink weight, paper tone, or shadow emphasis
- lift only if the sidebar supports reordering or moving the entity elsewhere
- selected pull-forward state
- anchor + primary + meta + state + trailing/action slots

Different content:

- member uses `AvatarObject`
- computer uses computer/tool identity and runtime metadata
- channel uses divider/folder identity

## Avatar Object Correction

We corrected an earlier naming mistake.

The primary object is:

```text
AvatarObject / 头像预制体
```

Not:

```text
AgentSealMark as the whole object
```

`AgentSealMark` and `HumanSignatureCard` started as frame variants inside the
avatar prefab, but the "seal" naming is misleading for product UI.

```text
AvatarObject
  avatar image
  agent identity frame OR human signature frame
  status dot / local halo
```

Therefore DM list avatars, message avatars, chat header avatars, and member list
avatars should be the same prefab with different instance size/density.

The avatar body is not required to be circular. The current code's base
`Avatar` uses a rounded tile, and agent generated avatars can be configured with
their own border radius. A blue circular initials ball inside a square identity
frame is not a product rule; it is visual debt or demo shorthand.

The generated agent avatar itself is also not technically forced to be circular:
the current DiceBear output uses a rounded-square SVG container (`rect` with
radius), not a `<circle>`. However, some generated face styles draw a
round/organic face blob inside that container. Treat that as avatar art style,
not as a component constraint.

Agent avatars should normally show their generated/avatar face content. Initials
are acceptable for human fallback or explicit error/fallback examples, but they
should not be the default visual stand-in for an agent when discussing the
product language.

For object-language work, prefer:

```text
AvatarObject
  identity frame
  avatar tile/image fills the frame
  agent: generated/avatar face content
  human: uploaded image or initials fallback
  top-right status dot
```

Avoid:

```text
square identity frame
  blue circular ball
  separate round face blob that looks pasted inside the tile
  agent shown as human-style initials by default
  separate decorative stamp in status position
```

### Default Frame Choice

The default agent avatar frame is:

```text
identity-thin / 轻身份框
```

This corresponds to option B in:

```text
evidence/avatar-border-options.html
```

Reason:

- it keeps the avatar content primary;
- it preserves the right-top status dot;
- it avoids turning identity into a review stamp;
- it is quiet enough for chat sidebars, message anchors, member rows, and detail
  headers.

Other frame ideas such as ledger line, left-top fold, brush line, or clip can be
explored as variants for specific object contexts, but the baseline should be
`identity-thin`.

### Avatar Stamp Correction

Do not place a cinnabar stamp or decorative red corner mark on the right-top
status area of the agent avatar frame.

Reason:

- the existing avatar already has a right-top status dot whose color changes
  with runtime/member state;
- a stamp mark in the same area competes with or covers that status indicator;
- "ink stamp" is a valid object in the system, but it belongs to review/approval
  actions, not to identity framing by default;
- structural frame details are allowed when they do not compete with status; if
  the avatar frame uses a folded-paper corner, prefer the left-top corner;
- object metaphors should explain function, not be added only because they fit
  the visual theme.

Target language:

```text
agent avatar frame = identity frame
right-top dot = status
left-top fold = optional paper-frame structure
review stamp = separate review/approval object
```

The later implementation should remove the red stamp/status-corner mark from
`AgentSealMark`, keep the right-top status dot clear, and rename the primitive
to a less misleading agent identity frame.

## Language To Use Going Forward

Good requests:

- “把左侧列表实体项的 hover 统一。”
- “Runtime Binding 是绑定账页，里面字段不要都像独立卡片。”
- “ObjectField 降级成字段标注，不要抢任务票据/消息纸片的层级。”
- “消息纸片和任务票据都属于 ContentObject，但要做出物种差异。”
- “头像预制体在私信列表和消息里应该一致，只是尺寸不同。”

Ambiguous requests that should be translated first:

- “这个框太重了” -> Which layer: `SidebarEntityItem`, `ContentObject`, `BindingLedger`, or `FieldMark`?
- “所有纸片改一下” -> Which object species: message, task, evidence, memory, or ledger?
- “这里不要描边” -> Is it a parent object boundary or a child field mark?

## Current Decision

The object-desk direction is still valid. The next design work should focus on
separating object species and hierarchy:

1. Keep strong object language for top-level interactive/readable objects.
2. Demote internal fields to ledger marks.
3. Give message/task/evidence/memory separate material signatures.
4. Keep shared primitives so later changes can target a class by language.
