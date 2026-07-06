# Inkframe Object Desk Design Spec

This branch is no longer a token-only "shuimo theme" experiment. It is a
product UI refactor toward the Inkframe demo language.

## Scene

A working desk with xuan paper, inkstone, cinnabar seal, and handwritten notes
laid out as physical objects. UI elements are object metaphors: chat messages
are paper slips, toolbars are small desk tools, evidence is a tilted sheet,
review state is a seal mark, memory is a pinned note, and task/state surfaces
are tickets or annotated papers.

## Reassessment: Product Surface Hierarchy

This refactor must be judged as a system, not as isolated CSS fixes. The
product has three visual layers:

1. **Desk environment** — the lowest layer. It uses the demo dry-paper field:
   a clean warm xuan-paper gradient plus faint fiber/grid marks. It must never
   carry wet ink, pink wash, dark residue, or state color.
2. **Working sheets** — the shell/list/main/sidebar layer. These are stable,
   square, readable paper sheets. They may use subtle paper depth, but they do
   not tilt, swim, or show decorative splashes.
3. **Hand objects** — messages, evidence slips, review seals, attachments,
   task tickets, and local runtime material. These are the only layer allowed
   to express personality, local hover lift, stamp motion, or small hand-placed
   rotation.

Implementation consequence: `globals.css` owns `--desk-paper-bg`,
`--sheet-paper-bg`, and `--slip-paper-bg`. Product shell surfaces must consume
these variables instead of rebuilding route-local backgrounds. Repeated
definitions of core shell classes such as `.sk-paper-field` are a design bug,
because Tailwind layer order can silently make the browser use the wrong
background.

## Visual Contract

- The base is dry xuan paper, not a full-page wet ink wash.
- Background must stay clean and bright: no dirty gray field, no pink page tint,
  no dark monochrome wash as the default working surface.
- Rotation is not a global style. Only deliberately hand-placed micro-objects may
  rotate: short chat slips, seal marks, tape strips, or an evidence sheet hover
  if it remains readable. Shells, task panels, composer, sidebars, lists, long
  text, toolbars, and computer/runtime bases must stay square and stable.
- Use the Inkframe demo palette as the current branch anchor:
  - `--paper`: `oklch(0.974 0.012 83)`
  - `--paper-cool`: `oklch(0.958 0.011 88)`
  - `--paper-deep`: `oklch(0.902 0.02 84-88)`
  - `--ink`: warm soot ink around `oklch(0.19-0.205 0.026-0.028 78)`
  - `--cinnabar`: `oklch(0.50 0.17 32)` for seal accents only
  - `--moss` / `--amber` for restrained material/status accents
- Keep 2px ink borders, square corners, and hard offset shadows.
- Do not use soft SaaS shadows, glass, rounded cards, blue-purple gradients, or
  broad decorative splashes.
- Pink/rose surfaces are not the background language. Cinnabar is a seal/accent,
  not a page tint.

## Chat-Specific Rules

- Short messages may tilt slightly and stay compact.
- Long messages must not have a large angle; they should become readable sheets.
- Message actions belong to the message object: author information, action tools,
  and the paper slip should stay visually clustered.
- Message action tools must be visible enough by default and must not be clipped
  by the message paper edge.
- The chat work area should read as a clean paper sheet on a desk, not as a
  pink/gray panel.

## Component Direction

- Put object language in shared primitives and CSS utilities, not page-local
  ad hoc styling.
- Stable slots such as `message-paper`, `message-actions`,
  `evidence-surface`, `review-stamp`, `task-ticket`, and
  `memory-fixed-note` are part of the reusable surface contract.
- Existing theme names may still exist mechanically while this branch is in
  flight, but the visual target is the object desk language above.

## Main Page Object Taxonomy and Alignment

The main product pages must be designed from object classes first, not from
route-local cards. When a page needs a new visual treatment, locate the object
class in this matrix and reuse the same primitive, alignment slots, and material
rules. This is the coordination layer that keeps chat, tasks, members, and
computers visually compatible.

The user-facing vocabulary for requesting those changes lives in
`visual-language-map.md`. Treat that file as the translation layer from phrases
such as “头像预制体”, “消息纸片”, “任务票据”, “电脑砚台”, and “审阅印章”
to concrete primitives, `data-object` selectors, and safe CSS/code knobs.

The current discussion checkpoint about object hierarchy, border strength, and
`Runtime Binding` as a ledger object lives in `object-language-alignment.md`.
Use it before changing border rules, field styling, or object-vs-field
distinctions.

### Shared Alignment Grammar

Every repeated object should be composed from the same conceptual slots even
when the page layout differs:

| Slot | Meaning | Visual rule |
|---|---|---|
| **anchor** | identity mark, task state mark, computer well, or attachment mark | small, left/top object; never a full-width stripe |
| **primary** | the readable name/content/title | stable paper text, not tilted for long content |
| **meta** | ids, timestamps, provider/runtime, source labels | `ObjectField`, `RuntimeChip tone="paper"`, or compact metadata |
| **state** | status/material/review phase | material state, stamp, chip, or localized well |
| **actions** | copy/retry/open/review/send controls | small desk tools near the object, not pushed to the far page edge |
| **evidence** | proof, artifact, trace, source, memory | attached sheet or evidence surface; never generic nested card |

Do not invent a new alignment grammar for a single route. If a new category does
not fit this table, extend the table and primitive set before styling the page.

### Page Object Matrix

| Page | Object class | Real-world metaphor | Required primitive / slot | Alignment emphasis |
|---|---|---|---|---|
| Chat / DM | Channel / DM | folder divider or labeled paper stack | `ChannelDivider` (`data-object="channel"`) | anchor + primary + state |
| Chat / DM | Human avatar | avatar prefab with signature frame | `AvatarObject` (`data-object="avatar"`) | identity anchor aligned with name/meta |
| Chat / DM | Agent avatar | same avatar prefab with seal frame | `AvatarObject` (`data-object="avatar"`) | seal state stays local to avatar prefab |
| Chat / DM | Message | paper slip / readable sheet | `MessagePaper` (`data-object="chat-message"`) | short slips may tilt; long sheets stay square |
| Chat / DM | Message actions | small desk tools | `MessageToolStrip` (`data-object="message-actions"`) | actions cluster with message author/body |
| Chat / DM | Task reference | small task ticket | `TaskTicket` or task toggle | ordinary message/link object, not embedded board |
| Chat / DM | Attachment | clipped/enveloped sheet | `AttachmentSheet` (`data-object="attachment"`) | attachment hangs from message, not as generic card |
| Tasks | Task item/detail | task ticket or working docket | `TaskMaterialSurface` (`data-object="task"`) | primary + state + assignee/meta aligned |
| Tasks | Evidence/source/activity | attached proof sheet | `EvidenceSurface` (`data-object="evidence"`) | evidence is distinct from task body |
| Tasks | Review | cinnabar stamp/markup | `ReviewStamp` (`data-object="review"`) | stamp is an action/state mark, not page tint |
| Tasks | Memory | fixed note | `MemoryFixedNote` (`data-object="memory"`) | fixed memory can fade/pin, candidate remains fresh |
| Members | Member row/detail | name tag + avatar prefab | `MemberNameTag` + `AvatarObject` | human/agent identity must share row alignment |
| Members | Agent runtime binding | avatar prefab + local runtime notes | `AvatarObject`, `RuntimeChip`, `ObjectField` | runtime meta aligns under identity, not as colored wall |
| Members | Permissions/config | labeled ledger fields | `ObjectField`, `ObjectToggleField` | label/value columns stay consistent |
| Members | Activity | proof strip / timeline note | `EvidenceSurface` or object surface | telemetry remains evidence, not chat content |
| Computers | Computer | inkstone / tool base | `ComputerInkstone` (`data-object="computer"`) | local well shows state; no full-width bottom rail |
| Computers | Runtime workspace | paper/tools on inkstone | `RuntimeChip tone="paper"`, `ObjectField` | runtime chips align as labels, not saturated blocks |
| Computers | Connect command | proof/instruction sheet | `AttachmentSheet` + `ObjectField` | one copyable command with metadata |
| Shared sidebars | Metrics | tally tags | `ObjectMetric` (`data-object="metric"`) | numbers line up as desk labels |

### Implementation Guardrail

Shared primitives expose both `data-slot` and `data-object`. `data-slot` names
the component contract; `data-object` names the product object class. Browser
checks, screenshots, and future design agents should use these attributes to
compare like with like:

- compare `data-object="chat-message"` across short/long message states;
- compare `data-object="avatar"` across DM list, message rows, chat header, and member rows;
- compare `data-object="task"` across task list, board, and detail surfaces;
- compare `data-object="member"` across chat sidebars and member pages;
- compare `data-object="computer"` across computers and member runtime binding;
- compare `data-object="evidence"` across task evidence and activity traces.

## Object Metaphor Map

These mappings guide the frontend refactor. They are not decorative labels;
they decide shape, motion, state, and density.

- **Workspace / app shell:** a working desk.
  - Large surfaces are stacked xuan-paper sheets on a desk.
  - The left rail is a tool spine or desk edge, not water.
  - Navigation should feel like reaching for desk tools, not SaaS tabs.

- **Chat message:** a paper slip.
  - Short slips can tilt and feel hand-placed.
  - Long slips become stable readable sheets.
  - Message actions are tiny tools clipped near the slip, not a toolbar pinned
    to the far edge of the row.

- **Channel:** a folder divider, thread booklet, or labeled paper stack.
  - Channel lists should feel like stacked dividers with handwritten labels.
  - Active channel is the sheet currently pulled forward.
  - Do not turn a channel into a room/scene; it remains a work container.

- **Thread:** a stitched side booklet or margin note chain.
  - Thread panel should read like a side booklet opened beside the main sheet.
  - Replies are smaller slips; root message remains visually tied to the main
    slip.

- **Human member:** a signature card.
  - Human identity is a handwritten name card / seal-side label.
  - Keep avatars small and legible; do not make humans into illustrated people.

- **Agent:** an active seal/brush mark tied to the existing avatar identity.
  - Agent identity can use a seal-like mark, ink color stripe, or animated
    material halo, but it must wrap the current `MemberAvatar` identity instead
    of replacing it with the demo's generic `avatar-ball`.
  - Running/thinking/output states can breathe or wet locally around the agent
    mark.
  - Agent should not become a cartoon person unless the existing avatar system
    deliberately supports that.

- **Computer / runtime status:** an inkstone or tool base.
  - A computer is the physical support that makes runtime work possible:
    inkstone, brush rest, tool tray, or desk block.
  - Online/offline maps to the inkstone being wet/ready vs dry/covered.
  - Runtime workspaces can appear as papers/tools placed on that base.

- **Task:** a task ticket or working docket.
  - Task status is a material state on the ticket/surface: wet/running,
    drying/review, fixed/done, overworked/blocked.
  - Task links inside chat remain ordinary tickets, not embedded boards.

- **Evidence:** an attached proof sheet.
  - Evidence is a tilted but readable sheet with clear source/type metadata.
  - Hover motion is allowed because it feels like lifting a proof sheet.

- **Review:** a cinnabar seal or markup stamp.
  - Review approval/rework is a stamp action.
  - Cinnabar is reserved for stamps and critical marks; never use it as a page
    background.

- **Memory:** a fixed note.
  - Candidate memory is a fresh note.
  - Solidified memory fades slightly or becomes pinned/pressed into the desk.

- **Files / artifacts:** envelopes or clipped attachments.
  - Images/videos should render as attached sheets, not generic cards.
  - Copy/download actions are small desk tools attached to the sheet edge.

- **Runtime/activity:** local material flow.
  - Use the `interactive-material-demo.html` idea for localized flow around a
    runtime card.
  - Never flood the whole app background with moving material.

## References

- `/Users/code/project/inkframe-demo/index.html`
- `/Users/code/project/inkframe-demo/task.html`
  - Product mapping: `/tasks` and task detail surfaces.
  - Extract: `Task Material Surface`, `Evidence Surface`, `Review Markup`,
    `Memory Fixing`, and state rails.
  - Rule: wet/material effects are local to the active task object. The whole
    page never becomes wet.
- `/Users/code/project/inkframe-demo/chat.html`
  - Product mapping: real `/chat/[channel]` and agent DM pages, not only
    `/chat` entry.
  - Extract: chat sheet, compact short-message paper, stable long-message
    sheets, ordinary task links inside messages, and local review stamps.
  - Rule: chat stays readable; task state belongs to task pages.
- `/Users/code/project/inkframe-demo/interactive-material-demo.html`
  - Product mapping: agent/runtime status cards and user-visible runtime panels,
    future local material background experiments.
  - Extract: runtime material card and local flowing material.
  - Caution: its `avatar-ball` is not directly compatible with SmallKhoj's
    current Croodles/agent avatar identity. If reused, it must wrap or augment
    the existing `MemberAvatar`/agent-color system instead of replacing it.

## Frontend Refactor Scope

This is a large frontend refactor branch. The target is not a permanent
three-theme switcher with a new token set; the target is to replace the default
product language with the object desk system if it proves strong enough.

Out of scope for this product-language pass: `/daemon` and `/control` operator
pages. They are internal control/observability surfaces and should not consume
design time or define the object-desk visual contract. If they already have
incidental changes in the branch, treat them as branch hygiene to separate from
the user-facing product refactor rather than as acceptance evidence.

Priority order:

1. Define shared object primitives and CSS utilities.
2. Make real chat/DM pages match `chat.html`.
3. Make task pages match `task.html`, including evidence/review/memory object
   separation.
4. Reconcile runtime/avatar material from `interactive-material-demo.html` with
   the real SmallKhoj avatar system.
5. Broaden across members/computers/settings only after chat and tasks carry the
   language well.
