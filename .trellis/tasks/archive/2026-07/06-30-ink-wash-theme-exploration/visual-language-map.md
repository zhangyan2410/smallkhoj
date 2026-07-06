# Inkframe Visual Language Map

This document is the shared vocabulary between the product owner, designers,
and coding agents. Its purpose is practical: the product owner should be able to
describe a change in natural visual language, and an agent should know the
object class, primitive, DOM selector, and safe modification knobs.

For the latest discussion checkpoint on hierarchy, border strength, field marks,
and `Runtime Binding` as a ledger object, read `object-language-alignment.md`.
That file also defines the motion contract: hover motion such as lift, drift, or
float should mean the object is movable, and movable objects must reveal where
they can move.

## Request Grammar

Use this sentence shape when describing a change:

```text
把 / 调整 + 对象词 + 部位槽位 + 质感或状态 + 页面范围
```

Examples:

- “把所有消息纸片的工具条拉回消息附近，不要贴到整行右侧。”
- “任务票据进入 review 时要更像正在等盖章，done 时淡一点。”
- “电脑砚台的在线状态要在墨池里显现，不要变成整页横杆。”
- “私信列表和消息里的头像应该是同一个头像预制体，只是实例位置不同。”
- “成员名签里 agent 和 human 头像要对齐；agent 可以有身份框，但不要遮住状态点。”
- “证据纸可以 hover 轻微抬起，但不要把 task 卡整体倾斜。”

## Alignment Slots

When discussing any repeated object, use these slot words:

| Slot word | Chinese shorthand | Meaning | Typical code target |
|---|---|---|---|
| `anchor` | 锚点 / 标记 | identity mark, state mark, inkstone well, attachment mark | avatar/status/well/icon area |
| `primary` | 主体 | message body, task title, member name, computer name | main text block |
| `meta` | 附注 / 标签 | timestamp, id, provider, runtime, source | `ObjectField`, `RuntimeChip tone="paper"` |
| `state` | 状态 | active/review/done/online/running material | `data-status`, `data-material`, stamp/well |
| `actions` | 工具 | copy, retry, open, review, send | `MessageToolStrip`, buttons near object |
| `evidence` | 证据 | trace, artifact, source, memory proof | `EvidenceSurface`, `AttachmentSheet` |
| `inline-token` | 行内标记 | mention, channel, task id, command, path | `.mention`, `.channel-token`, `.task-token`, `.path-token` |

If a change cannot say which slot it touches, clarify the slot before changing
the UI. This prevents “make it prettier” changes that drift across pages.

## Object Vocabulary

| User phrase | Object class | Metaphor | Primitive / selector | Pages | Safe knobs | Do not do |
|---|---|---|---|---|---|---|
| 头像 / 头像预制体 | `avatar` | avatar tile/image plus identity frame | `AvatarObject`, `[data-object="avatar"]` | chat / DM / members | size, frame variant, tile radius, status dot, local halo, alignment with name; agent uses generated/avatar face content | use raw `MemberAvatar` in product pages; make DM avatars and message avatars different classes; render a blue circular ball inside a square frame by default; use human-style initials as the default agent face |
| 消息纸片 | `chat-message` | paper slip / readable sheet | `MessagePaper`, `[data-object="chat-message"]` | chat / DM / thread | padding, density, short-message tilt, paper tone, text rhythm | tilt long messages; add the same clip to every message |
| 长消息笔记本 / agent 输出笔记本 | `chat-message notebook` | single-hole loose-leaf notebook page | `MessagePaper data-variant="notebook"`, `.notebook-page` | chat / DM / thread | move author/time under avatar anchor, large half-out ring on the top edge, filled ring interior without ruling lines, very light/no ring shadow, paper-edge gap under the ring, secondary hook ring drops into the paper, page indicator, page-corner affordance, real page-turn interaction when paginated | turn every short message into a notebook; show fake pagination without real extra content |
| 消息工具条 / 小工具 | `message-actions` | small desk tools near a slip | `MessageToolStrip`, `[data-object="message-actions"]` | chat / DM | placement near author/body, default visibility, compact icon spacing | push to full row right edge; clip under paper |
| 路径 / 命令 / 版本号 | `path-token` | highlighted evidence fragment inside text | `.path-token`, future `InlineToken tone="path"` | chat / evidence / task notes | pale yellow paper mark, mono font, local border, break long paths safely | color paths like warnings; let paths become the whole paragraph style |
| 输入纸 / composer | `composer` | writing sheet | `ChatComposerSurface`, `[data-object="composer"]` | chat / DM | border weight, paper depth, send/action grouping | rotate, float away from chat sheet |
| 频道签 / 分页签 | `channel` | folder divider / paper stack tab | `ChannelDivider`, `[data-object="channel"]` | chat entry / chat header | active pull-forward state, label density, divider shape | make it a room/scene; over-color inactive channels |
| 成员名签 | `member` | handwritten name tag | `MemberNameTag`, `[data-object="member"]` | chat members / members page | row alignment, identity/meta spacing, selected state | use unrelated row styles per page |
| agent 头像外框 / 身份框 | `agent-identity` | identity frame around avatar image | `AgentSealMark` for now, future `AgentIdentityFrame`, `[data-object="agent-identity"]`, inside `AvatarObject` | chat / members | default `identity-thin`, frame weight, optional left-top fold, status dot clearance, local halo, alignment with name | put a cinnabar stamp/status-corner mark on the avatar; cover the right-top status dot; use as a separate product object instead of the avatar prefab |
| 人类头像外框 / 签名框 | `human-identity` | signature frame around avatar image | `HumanSignatureCard`, `[data-object="human-identity"]`, inside `AvatarObject` | chat / members | simple frame, quiet identity mark | use as a separate product object instead of the avatar prefab |
| 任务票据 / 任务卷宗 | `task` | ticket / working docket | `TaskMaterialSurface`, `[data-object="task"]` | tasks board/list/detail | material state, state anchor, title/meta/action alignment | turn each task into a decorative card with local colors |
| 任务链接 / 小票 | `task-link` | small ticket inside text | `TaskTicket`, `[data-object="task-link"]` | chat / task source links | compact ticket style, status mark, hover affordance | embed a whole task board inside chat |
| 证据纸 | `evidence` | attached proof sheet | `EvidenceSurface`, `[data-object="evidence"]` | tasks / activity / sources | proof kind, source labels, attachment grouping; hover lift only when it can move/open into a visible target | merge evidence into task body so type is unclear |
| 审阅印章 / 盖章 | `review` | cinnabar stamp / markup | `ReviewStamp`, `[data-object="review"]` | tasks / memory proposals | stamp tone, tiny rotation, pressed/approved/rework state | use cinnabar as page background or general red tint |
| 记忆便签 / 固化便签 | `memory` | fixed note / pressed note | `MemoryFixedNote`, `[data-object="memory"]` | tasks / memory surfaces | fixed vs candidate material, faded/pressed state | make memory look like telemetry or chat content |
| 附件纸 / 信封 / 夹着的东西 | `attachment` | clipped sheet / envelope | `AttachmentSheet`, `[data-object="attachment"]` | chat / computers / members invite / artifacts | media kind, clipping, command/evidence formatting | use generic nested card for files |
| 电脑砚台 / 工具底座 | `computer` | inkstone / tool base | `ComputerInkstone`, `[data-object="computer"]` | computers / member runtime binding | local well, online/offline wetness, workspace papers on top | full-width bottom rail; page-level runtime stripe |
| runtime 纸标 | runtime label | paper label for runtime/provider/model | `RuntimeChip tone="paper"`, `[data-slot="runtime-chip"]` | home / members / computers / tasks | paper tone, small status dot, label density | saturated green/blue tag wall |
| 事件徽标 / 未读标记 | `event-badge` | attention badge / unread mark | future `EventBadge`, `[data-object="event-badge"]` | chat sidebar / DM / thread markers / activity entry | unread count, new-event state, clears after viewed, shared badge grammar | use total message count as attention; make one-off route-local pink badges |
| 字段账本 | `field` | ledger label/value row | `ObjectField`, `[data-object="field"]` | members / computers / settings / login/join | label/value alignment, mono only for ids/commands | route-local raw label boxes |
| 指标签 | `metric` | tally tag | `ObjectMetric`, `[data-object="metric"]` | sidebars / dashboards | number scale, label alignment, compact grouping | hero metric card pattern |
| 开关账本 | `toggle-field` | permission ledger toggle | `ObjectToggleField`, `[data-object="toggle-field"]` | settings / permissions / task forms | checkbox alignment, label/value copy | custom one-off toggles |
| 语言切换 / 显示语言 | `preference-control` | settings preference field | `LanguageSwitcher`, settings preference row | settings only | move into settings; align with other preference fields; keep global chrome clean | show as a persistent product-surface toolbar button |
| 工作桌背景 | desk environment | dry xuan-paper desk | `sk-workbench-desk`, `sk-paper-field` | all product pages | dry paper fibers, brightness, clean sheet layering | pink/dark/dirty wet full-page wash |

## Modifier Vocabulary

Use these modifiers to describe how a class of objects should change:

| Phrase | Meaning | Implementation direction |
|---|---|---|
| 更干净 | reduce visual noise | lighten paper, remove wet/dark residue, reduce decorative texture |
| 更像纸片 | strengthen slip material | adjust `--slip-paper-bg`, border, hard shadow, compact padding |
| 更像笔记本 | long agent output becomes a bound reading object | use `chat-message notebook`: avatar identity on the left, a large ring half outside/inside the top edge with no internal ruling line, a visible paper-edge gap, a second hook ring that drops into the paper edge, page footer, and real page-turn affordance only when paginated |
| 更像票据 | stronger task/document affordance | clarify title/meta/state alignment, add ticket-like density |
| 更像证据 | make source/proof readable | add source labels, proof kind; use hover lift only if the proof sheet has a visible destination/open target |
| 更像盖章 | emphasize review action | tune `ReviewStamp`, cinnabar tone, pressed mark, tiny rotation |
| 去掉头像印章 | preserve status semantics | remove cinnabar stamp/corner from agent avatar frame; keep right-top status dot readable |
| 折角放左上 | preserve status corner | paper-frame fold may sit on the left-top corner; right-top remains reserved for status |
| 默认头像外框用 B | use identity-thin | agent identity frame defaults to option B / `identity-thin` from the avatar border options reference |
| 头像不要蓝球 | fill the avatar tile | use the shared avatar tile/image shape; do not force fallback initials into a circular blue ball inside the identity frame |
| 头像不要方框套圆脸 | integrate avatar art | agent face art should fill or integrate with the avatar tile; avoid a separate circular face/blob pasted inside a square frame |
| agent 头像要像 agent | preserve generated face | agent avatar examples should use generated/avatar face content, not initials-only placeholders unless explicitly showing fallback |
| 更像砚台 | emphasize tool base | tune `ComputerInkstone` well/state, keep base local |
| 状态更明显 | make lifecycle visible | use `data-status`, material state, local mark/chip/well; do not color whole page |
| 有新消息 / 未读 | unseen event exists | show `EventBadge` / `UnreadMark` on the owning channel, DM, or thread marker; clear after viewed |
| 淡一点 | make done/settled quieter | use fixed/dry material, lower contrast, avoid disabled unreadability |
| 聚在一起 | improve object cohesion | move `actions`/`meta` closer to `primary` within same object |
| 有段落感 | improve message reading rhythm | add paragraph spacing, quiet ruling lines, marker blocks, list rhythm, and specialized inline tokens; do not rely on raw markdown margins alone |
| 路径有特殊颜色 | paths/commands are evidence fragments | use `path-token` with pale yellow paper, mono text, and a local border like Raft-style command marks |
| 对齐 | align repeated rows/classes | check anchor/primary/meta/state/actions slots across same object class |
| 能移动 / 可拖 | object can change position | hover lift/drift/float is allowed only with visible destination/drop target |
| 有动效 | motion communicates affordance | if hover motion changes position, the object must be movable; otherwise use ink/border/tone feedback |
| 不要脏 | remove wet-wash dirtiness | keep desk/sheet dry; reserve material effects for local objects |
| 不要都倾斜 | constrain hand placement | only `chat-message` short density and `review` stamps may rotate |

## Targeting Rules

### Change One Object Class

If the owner says “所有消息纸片”, “所有任务票据”, “所有电脑砚台”, or a similar
class phrase, change the shared primitive or its CSS utility first:

- `MessagePaper` / `.sk-message-paper`
- `TaskMaterialSurface` / `.sk-task-material-surface`
- `ComputerInkstone` / `.sk-computer-inkstone`
- `MemberNameTag` / `.sk-member-name-tag`
- `EvidenceSurface` / `.sk-evidence-surface`
- `ReviewStamp` / `.sk-review-stamp`

Only touch route code when the problem is composition, missing slot order, or
data mapping.

### Change One Page

If the owner says “chat 页面”, “task 页面”, “member 页面”, or “computer 页面”,
keep the page’s object taxonomy intact. A page-level change should reposition
objects or change density, not invent a new object language.

### Change One State

If the owner says “review 状态”, “done 状态”, “online 状态”, or “running 状态”,
use local state markers:

- task lifecycle: `TaskMaterialSurface` material / `data-task-material`
- review lifecycle: `ReviewStamp` tone
- computer lifecycle: `ComputerInkstone` well / `data-status`
- agent lifecycle: `AvatarObject` status dot / `data-status`
- memory lifecycle: `MemoryFixedNote` / `data-fixed`

Never express one object’s state by tinting the whole page background.

## Examples of Good Requests

- “把 chat 里的头像、消息纸片和成员名签对齐：anchor 统一在左，工具条跟作者信息聚在一起。”
- “把私信列表和消息里的头像统一成同一个预制体，agent 只是头像外框不同。”
- “把 task 列表里的任务票据做得更像票据，不要像普通卡片；review 状态加一点等盖章的感觉。”
- “把 member 页面 agent 的运行态只放在头像对象和 runtime 纸标上，不要整行变色。”
- “把 computer 页面电脑砚台的 online/offline 区分做明显，但别变成横条。”
- “把证据纸 hover 做得更有拿起纸的感觉，但不要影响任务卷宗整体布局。”
- “把语言切换放到 settings 里，不要作为每个页面都露出的工作台按钮。”
- “把 chat 侧边栏里的频道和私信加事件徽标，有新消息显示，点进去看过后消失。”

## Examples of Misaligned Requests

These should be translated before implementation:

- “这个卡片好看点” → Which object class? Which slot?
- “所有东西都做成水墨” → Which material: paper, stamp, inkstone, proof, or note?
- “状态用红色明显一点” → Is it review stamp, danger, or lifecycle state?
- “页面更艺术” → Which object should become more tactile, and which should stay stable?
