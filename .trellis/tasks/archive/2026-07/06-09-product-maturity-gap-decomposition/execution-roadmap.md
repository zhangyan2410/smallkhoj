# Product Maturity Execution Roadmap

## Purpose

This roadmap turns the 25 child tasks into an execution sequence. It is the parent-level plan for moving SmallKhoj from backend-capability verification into a Slock-class product experience with a distinct cyan/blue SmallKhoj UI.

Use this file when choosing the next task, assigning agents, or deciding what can run in parallel.

## Operating Principles

* Do not implement everything at once. Complete one Trellis child task at a time and save real-test evidence before moving on.
* Foundation tasks must establish reusable shell/design/testing conventions before deep feature polish.
* Product surfaces should land before micro-interactions that depend on their layout.
* Runtime/control-plane tasks must cross-check browser, API/DB, and `smallkhoj-trace` when behavior spans daemon/runtime.
* Every task should leave the app more product-like, not merely more demo-like.

## Phase 0: Quality Gate And Shared Language

Goal: make later work verifiable and keep agents aligned.

1. `06-09-trellis-real-test-quality-gate`
   Make the real browser/runtime evidence gate fully operational and harmonize `docs/real-runtime-dm-reply-sop.md`.

2. `06-09-database-observation-sop`
   Give the human supervisor a low-density DB observation path for marker-based debugging.

3. `06-09-human-debug-workbench`
   Define the guided debug surface and connect marker, browser, API, DB, trace, and task evidence.

Phase exit criteria:

* Real-test evidence format is understood.
* A marker can be followed through browser/API/DB/trace for at least one workflow.
* Later task PRDs can reuse the same SOP without re-inventing it.

## Phase 1: Product Shell And Visual System

Goal: stop the app from feeling like a collection of backend verification pages.

4. `06-09-frontend-design-system-cyan-blue`
   Establish tokens, status chips, rows, panels, tabs, and empty/loading/error states.

5. `06-09-frontend-product-shell-and-navigation`
   Build the persistent app shell and first-level navigation.

6. `06-09-settings-and-admin`
   Add the Settings/Admin destination so shell navigation has a real endpoint.

Phase exit criteria:

* `/` opens the product shell.
* Chat, Tasks, Members, Computers, Settings are reachable through consistent navigation.
* Screenshots show SmallKhoj's cyan/blue identity, not Slock's brutalist style.

## Phase 2: Core Human Supervisor Workflows

Goal: make the main daily product surfaces usable and connected.

7. `06-09-chat-product-surface`
   Build Activity/Saved/Channels/DMs/conversation tabs around the existing chat base.

8. `06-09-tasks-board-list-filters`
   Replace form-centric tasks with board/list/filter/detail workflow.

9. `06-09-members-agent-profile-tabs`
   Build selected member/agent detail with profile, permissions, DMs, reminders, workspace, apps, activity tabs.

10. `06-09-computers-product-detail`
    Build selected computer detail with runtimes, daemon status, workspaces, connect/reconnect, and safety actions.

Parallelism:

* Chat and Tasks can run in parallel after the shell/design system lands, but task-from-message should wait until both are stable.
* Members and Computers can run in parallel, but runtime lifecycle controls should wait until their detail layouts exist.

Phase exit criteria:

* A human can navigate the product, inspect channels/DMs/tasks/agents/computers, and understand online/stopped/runtime status.
* Each surface has real browser evidence.

## Phase 3: Collaboration Depth

Goal: make chat/task workflows feel mature and Slock-like in behavior.

11. `06-09-message-actions-thread-reactions-saved`
    Add message-level actions.

12. `06-09-thread-panel-and-summary`
    Make thread handling reliable and visible.

13. `06-09-task-from-message-and-thread`
    Connect chat/thread context to tasks.

14. `06-09-files-surface-and-attachments`
    Add files and attachment workflows.

15. `06-09-task-review-evidence`
    Add evidence chains and review context to tasks.

16. `06-09-notifications-inbox-saved-search`
    Add the attention layer: notifications, inbox, saved, global search.

Phase exit criteria:

* Messages can become tasks.
* Threads, files, saved items, and search are visible product workflows.
* Task review has evidence, not only status text.

## Phase 4: Agent And Runtime Operations

Goal: make agents manageable as product actors, not just backend rows.

17. `06-09-agent-permissions-ui-and-sync`
    Make agent permissions visible/editable and synchronized where possible.

18. `06-09-agent-activity-diagnostics`
    Summarize runtime/agent activity for humans.

19. `06-09-runtime-lifecycle-controls`
    Add stop/restart/kill/reconcile controls.

20. `06-09-runtime-provider-expansion`
    Expand runtime provider UX and supported driver paths.

21. `06-09-daemon-packaged-onboarding`
    Productize daemon onboarding so users do not need repo-path commands.

Phase exit criteria:

* Agents can be created, inspected, permissioned, diagnosed, and restarted through product UI.
* Runtime provider status is understandable.
* Daemon onboarding is safe and product-grade.

## Phase 5: Platform Maturity

Goal: make SmallKhoj credible beyond local MVP use.

22. `06-09-auth-multi-server-account`
    Productize account/session/server identity.

23. `06-09-api-key-management-ui`
    Add API key/token management and rotation safety.

24. `06-09-trace-to-task-evidence`
    Make trace output attachable and reviewable as task evidence.

25. `06-09-production-readiness-broadcast-cache`
    Address multi-instance event/control broadcast and cache readiness.

Phase exit criteria:

* Auth/server/API key surfaces are no longer dev-only.
* Trace evidence is part of review.
* Multi-instance risks are understood and either implemented or explicitly scheduled.

## Recommended First Sprint

Start with:

1. `06-09-trellis-real-test-quality-gate`
2. `06-09-frontend-design-system-cyan-blue`
3. `06-09-frontend-product-shell-and-navigation`
4. `06-09-chat-product-surface`
5. `06-09-tasks-board-list-filters`

Why this order:

* It creates a verification gate first.
* It creates the visual and navigation foundation.
* It then improves the two most-used product workflows: Chat and Tasks.

## Completion Definition For This Parent Program

This parent program is complete only when:

* All 25 child tasks are completed or consciously replaced by updated child tasks.
* Each browser/runtime child task has real-test evidence.
* SmallKhoj's main workflows can be operated from the frontend without relying on curl, hidden backend pages, or agent-only debug knowledge.
* The UI clearly reads as SmallKhoj's cyan/blue product, not a Slock visual clone.
