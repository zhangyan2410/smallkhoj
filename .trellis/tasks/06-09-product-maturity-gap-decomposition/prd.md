# brainstorm: product maturity gap decomposition

## Goal

Turn SmallKhoj from an MVP/backend-verification surface into a product-maturity roadmap comparable to Slock's current product depth, while keeping SmallKhoj's visual identity distinct: cyan/blue, calmer, cleaner, and informed by `zy-think/design/khoj-design-spec.md` rather than copying Slock's brutalist UI.

This task is a parent planning task. Its output is not one implementation patch. Its output is a complete Trellis decomposition: product PRDs, implementation plans, specs, real browser test SOPs, and child tasks that agents can execute one by one until SmallKhoj reaches Slock-like product maturity.

## What I already know

* The target product to study is `https://app.slock.ai/`.
* The user wants the frontend to be visually different from Slock, with cyan/blue colors and UI inspiration from `zy-think/design/khoj-design-spec.md`.
* The backend already implements most Slock-like capability: computers, members/agents, agent workspaces, channels, messages, tasks, files, reminders, activity, daemon connect/register/heartbeat, and runtime control.
* Current SmallKhoj frontend is useful but still reads like a backend control/verification panel in many places.
* Project browser/UI verification must use `/Users/code/project/smallkhoj/agent/daemon/webdriver/twd.py`, not Playwright.
* Real testing has already started through `docs/real-runtime-dm-reply-sop.md`; the user wants real testing SOP to become part of the Trellis flow, not an ad-hoc external habit.
* There are existing current design references in `zy-think/design/total-design.md`, `zy-think/architecture/current-architecture.md`, `zy-think/design/slock-design-spec.md`, and `zy-think/design/khoj-design-spec.md`.
* Existing local browser tabs show both real Slock and local SmallKhoj, so comparison can be evidence-based.

## Current Evidence

Research and screenshots captured in this task:

* `research/slock-product-surface.md` - real Slock page observations through project WebDriver.
* `research/smallkhoj-current-gap.md` - local SmallKhoj page observations and gap framing.
* `assets/slock-current-computer.png`
* `assets/slock-members-activity.png`
* `assets/slock-tasks.png`
* `assets/slock-chat.png`
* `assets/smallkhoj-home-current.png`
* `assets/smallkhoj-tasks-current.png`

Trellis workflow/spec updates made in this planning task:

* `.trellis/workflow.md` Phase 2.2 and Phase 3.1 now require Real Test SOP evidence for browser-facing or runtime/control-plane changes.
* `.trellis/spec/frontend/quality-guidelines.md` now requires project WebDriver (`twd.py`) browser smoke evidence instead of Playwright for repository UI verification.
* `.trellis/spec/backend/runtime-slock-integration.md` now applies WebDriver + trace cross-checks to product-facing runtime/control-plane changes, not only chat/thread bugs.

Program coordination docs:

* `execution-roadmap.md` defines the recommended phase order, dependencies, parallelism, and parent-level completion definition.
* `agent-handoff-sop.md` defines how agents should pick up child tasks, what evidence they must produce, and how check agents should verify work.
* `review-packet.md` is the one-page confirmation packet for deciding whether the decomposition is ready to execute.

## Assumptions

* SmallKhoj should match Slock's product capability and workflow depth, not Slock's exact visual style.
* The first product-maturity milestone should prioritize the human supervisor's daily flow: see what exists, understand agent state, assign/debug work, inspect evidence, and run real browser/runtime checks.
* Some backend gaps will still emerge during frontend completion; child tasks should include cross-layer validation instead of assuming the backend is finished.
* Trellis child tasks should stay small enough for agents to implement and verify with real browser evidence.

## Requirements

### R1. Slock Product Surface Inventory

Create a maintained inventory of Slock's observable product surfaces:

* Global navigation: Search, Chat, Tasks, Members, Computers, Settings, notifications.
* Chat: channels, DMs, activity, saved, tabs, thread reply, reaction, save, as-task, attachments, files.
* Tasks: board/list, status columns, channel/creator/assignee filters, task cards linked to channels/messages.
* Members: humans/agents split, graph, profile, permissions, agent DMs, reminders, workspace, apps, activity diagnostics.
* Computers: list/detail, runtimes, update status, agent list, workspace scan, delete safety, agent workspace state.

### R2. SmallKhoj Gap Matrix

Produce a gap matrix comparing Slock and SmallKhoj across:

* Product shell/navigation
* Visual system
* Chat and collaboration
* Threads and message actions
* Tasks and review evidence
* Members/agents and permission/profile surfaces
* Computers/workspaces/runtime lifecycle
* Files/reminders/activity
* Search/inbox/notifications/saved
* Authentication/multi-server/API key management
* Observability/debugging for human supervisor and agents
* Packaging/onboarding for daemon/runtime

### R3. Trellis Child Task Decomposition

Create concrete child tasks, each with at least:

* `prd.md`
* implementation plan or `info.md`
* relevant spec/context references
* real browser/API/runtime test SOP
* acceptance criteria
* definition of done

The decomposition should be broad enough that completing the child tasks would make SmallKhoj feel like a mature Slock-class product.

### R4. Real Test SOP Integration

Add real testing into Trellis as a required quality gate for browser-facing or runtime/control-plane tasks:

* Use `twd.py` for browser actions and screenshots.
* Use unique markers for each manual/agent-driven real test.
* Cross-check visible DOM, backend/API state, database state when relevant, daemon trace, and runtime/agent reply path.
* Store SOP and evidence paths in the task directory.
* Treat real test failure as a failing Trellis quality gate even if unit/e2e tests pass.

### R5. Visual Direction

Define a SmallKhoj-specific frontend direction:

* cyan/blue primary family
* calm, dense, product-workbench style
* strong hierarchy without Slock brutalist styling
* no oversized landing page; first screen is the actual app shell
* no copying Slock's black-border/pink brutal accents
* preserve shadcn/Tailwind local conventions where useful

## Created Child Tasks

### Foundation

1. `frontend-product-shell-and-navigation`
   Build the app shell: left rail, secondary sidebar, content header, notifications, search entry, responsive layout, and cyan/blue design tokens.

2. `frontend-design-system-cyan-blue`
   Replace ad-hoc panel styling with a reusable SmallKhoj visual system: tokens, status badges, runtime chips, list rows, tabs, icon buttons, empty/loading/error states.

3. `trellis-real-test-quality-gate`
   Add real browser/runtime SOP expectations into Trellis workflow/spec docs and task templates.

### Chat / Collaboration

4. `chat-product-surface`
   Bring Chat closer to Slock depth: Activity, Saved, Channels, DMs, unread/mention counts, channel header, Chat/Tasks/Files tabs.

5. `message-actions-thread-reactions-saved`
   Implement polished per-message actions: thread, reactions, saved/bookmark, as-task, copy link, attachment affordances.

6. `thread-panel-and-summary`
   Make threads a first-class panel with root context, replies, summary/status, and real test coverage.

7. `files-surface-and-attachments`
   Build Files tab/page and message attachment workflows with backend/API verification.

### Tasks / Work Management

8. `tasks-board-list-filters`
   Upgrade Tasks from form-centric page to board/list product view with channel/creator/assignee filters and task detail.

9. `task-review-evidence`
   Add task evidence chain: real test markers, screenshots, logs, agent notes, review status, reopen reason.

10. `task-from-message-and-thread`
    Make "As Task" from message/thread reliable and visible in both Chat and Tasks.

### Members / Agents

11. `members-agent-profile-tabs`
    Build member detail with Profile, Permissions, Agent DMs, Reminders, Workspace, Apps, Activity.

12. `agent-permissions-ui-and-sync`
    Productize permission config UI and synchronization to agent/runtime, with clear future enforcement boundary.

13. `agent-activity-diagnostics`
    Build a human-readable activity diagnostics panel that summarizes runtime state, not just raw logs.

### Computers / Runtime

14. `computers-product-detail`
    Upgrade Computers detail to match required state visibility: runtimes, update available, agent list, workspace scan, connect/reconnect, delete safety.

15. `runtime-lifecycle-controls`
    Add stop/restart/kill/reconcile controls and real runtime verification.

16. `daemon-packaged-onboarding`
    Replace repo-path daemon command with packaged launcher/onboarding flow.

17. `runtime-provider-expansion`
    Add provider UX and support for Codex CLI, Kimi CLI, OpenCode, Antigravity, Pi/custom where backend allows.

### Supervisor Observability

18. `human-debug-workbench`
    Create a supervisor debug workbench that links browser DOM, API rows, DB facts, trace lines, daemon sessions, and runtime messages by unique marker.

19. `trace-to-task-evidence`
    Let `smallkhoj-trace` output become task evidence and SOP proof.

20. `database-observation-sop`
    Add DBX/PostgreSQL observation recipes for non-developer product debugging.

### Platform Maturity

21. `auth-multi-server-account`
    Productize auth, account/server selection, login/logout, and session behavior.

22. `api-key-management-ui`
    Add human-facing API key management, rotation, and token safety surfaces.

23. `notifications-inbox-saved-search`
    Build notification center, activity inbox, saved items, and global search.

24. `settings-and-admin`
    Add server/user settings, runtime defaults, feature flags, and admin safety controls.

25. `production-readiness-broadcast-cache`
    Plan and implement Redis/broadcast/multi-instance behavior where needed.

All 25 tasks above now have Trellis child task directories with `prd.md`, `info.md`, `implement.jsonl`, and `check.jsonl`. The `info.md` files provide the implementation plan, spec contract, Real Test SOP, evidence checklist, and sequencing notes for each task:

* `06-09-frontend-product-shell-and-navigation`
* `06-09-frontend-design-system-cyan-blue`
* `06-09-trellis-real-test-quality-gate`
* `06-09-chat-product-surface`
* `06-09-message-actions-thread-reactions-saved`
* `06-09-thread-panel-and-summary`
* `06-09-files-surface-and-attachments`
* `06-09-tasks-board-list-filters`
* `06-09-task-review-evidence`
* `06-09-task-from-message-and-thread`
* `06-09-members-agent-profile-tabs`
* `06-09-agent-permissions-ui-and-sync`
* `06-09-agent-activity-diagnostics`
* `06-09-computers-product-detail`
* `06-09-runtime-lifecycle-controls`
* `06-09-daemon-packaged-onboarding`
* `06-09-runtime-provider-expansion`
* `06-09-human-debug-workbench`
* `06-09-trace-to-task-evidence`
* `06-09-database-observation-sop`
* `06-09-auth-multi-server-account`
* `06-09-api-key-management-ui`
* `06-09-notifications-inbox-saved-search`
* `06-09-settings-and-admin`
* `06-09-production-readiness-broadcast-cache`

## Acceptance Criteria

* [x] Slock product surface research exists with screenshots and DOM/text evidence.
* [x] SmallKhoj gap matrix exists and references real local evidence.
* [x] Parent PRD lists child tasks covering all major product maturity areas.
* [x] All 25 child task directories are created and linked under this parent.
* [x] Trellis workflow/spec updates define when real browser/runtime SOP is required.
* [x] Each created child task includes acceptance criteria and real test SOP expectations.
* [x] Each child task includes an `info.md` implementation handoff with plan/spec/SOP/evidence checklist.
* [x] Parent task includes an execution roadmap and agent handoff SOP.
* [x] Parent task includes a one-page review packet for user confirmation.
* [x] User confirms the decomposition direction before large implementation starts.

## Definition of Done

* Parent PRD completed and reviewed.
* Research artifacts persisted under this task.
* Child tasks created with meaningful PRDs, not placeholder names.
* Child tasks have implementation handoff plans in `info.md`.
* Parent task has a dependency-aware execution roadmap.
* Parent task has an agent handoff SOP for implementation and verification.
* Parent task has a concise review packet for user approval.
* Trellis real-test SOP integration drafted or implemented.
* No unrelated user changes are reverted or included.

## Out of Scope

* Implementing all child tasks inside this parent planning pass.
* Copying Slock's exact visual style.
* Using Kimi WebBridge for browser exploration or verification.
* Replacing backend architecture without evidence from a child task.

## Technical Notes

* WebDriver harness: `/Users/code/project/smallkhoj/agent/daemon/webdriver/twd.py`.
* Current Trellis version notice: `Trellis update available: 0.5.19 -> 0.6.0-beta.17, run npm install -g @mindfoldhq/trellis@latest`.
* Current repo has many pre-existing dirty files; this planning task should avoid changing unrelated WIP.
* Frontend code currently lives under `frontend/app/**` with Next.js, Tailwind, shadcn-style local components, and server actions.
* Backend/runtime specs already include a WebDriver acceptance note in `.trellis/spec/backend/runtime-slock-integration.md`.
