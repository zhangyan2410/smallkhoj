# SmallKhoj Current Gap Research

Captured from local `http://127.0.0.1:3000` with project WebDriver on 2026-06-09.

## Evidence Files

* `../assets/smallkhoj-home-current.png`
* `../assets/smallkhoj-tasks-current.png`

## Current Local Surface

The current homepage shows:

* Slock heading and short tagline.
* Channels list.
* New channel form.
* Members list.
* Start DM form.
* Links to Tasks, Control Plane, Members, Computers, and API docs.

This confirms core backend workflows are reachable from the browser. It does not yet feel like a mature app shell.

## Current Tasks Page

The current Tasks page shows:

* Header and Control Plane link.
* Stats: total/open/agents.
* Create Task form.
* Update Task form.
* Task list area.

At capture time the backend returned zero tasks. The page is functional but form-centric. It lacks board/list workflow, source channel grouping, task detail, review evidence, task cards, and filters comparable to Slock.

## Current Chat Implementation Notes

Inspection of `frontend/app/chat/[channel]/channel-client.tsx` shows:

* channel and DM sidebars
* message list
* send message
* thread panel and thread replies
* member add/remove for channels

This is a strong base, but product gaps remain:

* no Activity/Saved sections as first-class navigation
* no Chat/Tasks/Files tabs on conversation detail
* no reaction/save/as-task polished message actions
* no attachment UI beyond future file surface
* limited unread/mention/task count treatment

## Current Members Implementation Notes

Inspection of `frontend/app/members/page.tsx` shows:

* aggregate stats
* create agent form
* member cards with profile fields, skills, permissions/actions data, IDs

Product gaps:

* no selected-member split layout
* no tabs for Profile, Permissions, Agent DMs, Reminders, Workspace, Apps, Activity
* permission editing is not yet a product workflow
* activity diagnostics are not a human-readable operational surface

## Current Computers Implementation Notes

Inspection of `frontend/app/computers/page.tsx` shows:

* connect/reconnect command generation
* computer cards with IDs, lease, runtimes, agent workspace table
* registered/workspace/running stats

Product gaps:

* no Slock-style detail page with selected computer sidebar
* runtime installed/not-installed/update available state is not fully expressed
* workspace scan and agent create/select flows are not productized
* stop/restart/kill/reconcile controls remain missing or separate
* delete safety and lifecycle explanations need product treatment

## Gap Matrix

| Area | Slock-like maturity target | SmallKhoj current state | Gap |
| --- | --- | --- | --- |
| Product shell | persistent app nav + workspace sidebar | homepage links and per-page headers | create app shell |
| Visual identity | cohesive product UI | mixed verification panels | cyan/blue design system |
| Chat | channels/DM/activity/saved/actions/files/tasks | channels/DM/thread basics | actions, files, saved, activity, tabs |
| Tasks | board/list/filter/detail/evidence | create/update forms and list | workflow UI and evidence |
| Members | selected member tabs | cards + create form | detail/tabs and editable workflows |
| Computers | detail with runtime/update/workspaces/actions | cards + connect/reconnect | selected detail and lifecycle actions |
| Runtime | visible lifecycle, stopped warnings, diagnostics | status fields and daemon page | controls and diagnostics |
| Files | conversation files and attachments | backend surface exists | frontend files product |
| Reminders | member/agent reminders | backend surface exists | frontend reminders product |
| Activity | human-readable + deep logs | daemon/control traces separate | diagnostics workbench |
| Search/Saved/Inbox | global product entry points | absent/partial | build nav and data surfaces |
| Real testing | operational proof with browser/runtime | SOP exists separately | Trellis quality gate |

## First-Wave Recommendation

The first wave should not attempt every backend feature. It should create the product skeleton where later features can land:

1. App shell/navigation/design tokens.
2. Chat surface with Activity/Saved/Channels/DM and conversation tabs.
3. Tasks board/list/detail with real evidence.
4. Members/computers selected detail layouts.
5. Trellis real-test gate so every UI/runtime task proves behavior in the same style.
