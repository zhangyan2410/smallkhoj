# Review Packet

## What This Is

This is the one-page review packet for the SmallKhoj product-maturity Trellis decomposition.

Use it to decide whether the planning direction is ready to move into implementation.

## Decision To Make

Approve or revise this decomposition:

* Slock is the product capability reference.
* SmallKhoj should not copy Slock's visual style.
* SmallKhoj UI direction is cyan/blue, calmer, denser, and product-workbench-like.
* Work should proceed one Trellis child task at a time with real browser/runtime evidence.
* The first implementation task should be `06-09-trellis-real-test-quality-gate`.

## What Was Produced

Parent planning task:

* `prd.md`
* `research/slock-product-surface.md`
* `research/smallkhoj-current-gap.md`
* `real-test-sop-integration.md`
* `execution-roadmap.md`
* `agent-handoff-sop.md`
* `completion-audit.md`
* `review-packet.md`
* Slock and SmallKhoj screenshots under `assets/`

Child tasks:

* 25 child task directories.
* Every child has `prd.md`, `info.md`, `implement.jsonl`, `check.jsonl`, and `task.json`.
* Every child `info.md` has plan, spec contract, Real Test SOP, evidence checklist, and sequencing notes.

Trellis flow/spec updates:

* `.trellis/workflow.md` now treats real-test evidence as a quality gate for browser-facing or runtime/control-plane work.
* `.trellis/spec/frontend/quality-guidelines.md` now requires the project WebDriver (`twd.py`) for repository UI/browser verification.
* `.trellis/spec/backend/runtime-slock-integration.md` now requires WebDriver plus API/DB/trace cross-checks for product-facing runtime/control-plane changes.

## The 25 Child Tasks

### Foundation

1. `06-09-trellis-real-test-quality-gate`
2. `06-09-frontend-design-system-cyan-blue`
3. `06-09-frontend-product-shell-and-navigation`

### Core Product Surfaces

4. `06-09-chat-product-surface`
5. `06-09-tasks-board-list-filters`
6. `06-09-members-agent-profile-tabs`
7. `06-09-computers-product-detail`

### Collaboration Depth

8. `06-09-message-actions-thread-reactions-saved`
9. `06-09-thread-panel-and-summary`
10. `06-09-task-from-message-and-thread`
11. `06-09-files-surface-and-attachments`
12. `06-09-task-review-evidence`
13. `06-09-notifications-inbox-saved-search`

### Agent / Runtime Operations

14. `06-09-agent-permissions-ui-and-sync`
15. `06-09-agent-activity-diagnostics`
16. `06-09-runtime-lifecycle-controls`
17. `06-09-runtime-provider-expansion`
18. `06-09-daemon-packaged-onboarding`

### Supervisor / Platform Maturity

19. `06-09-human-debug-workbench`
20. `06-09-trace-to-task-evidence`
21. `06-09-database-observation-sop`
22. `06-09-auth-multi-server-account`
23. `06-09-api-key-management-ui`
24. `06-09-settings-and-admin`
25. `06-09-production-readiness-broadcast-cache`

## Recommended First Sprint

Start here:

1. `06-09-trellis-real-test-quality-gate`
2. `06-09-frontend-design-system-cyan-blue`
3. `06-09-frontend-product-shell-and-navigation`
4. `06-09-chat-product-surface`
5. `06-09-tasks-board-list-filters`

Why:

* The real-test gate prevents later "looks done but not actually proven" work.
* The design system and shell prevent every page from inventing its own UI.
* Chat and Tasks are the highest-leverage product workflows.

## Approval Criteria

Approve this decomposition if these statements feel correct:

* "This gives us enough work packages to push SmallKhoj toward Slock-like maturity."
* "The frontend direction is intentionally not Slock's visual style."
* "The first sprint order makes sense."
* "Every implementation task should produce real browser/runtime evidence."

## If You Want Changes

Common revisions:

* Add or remove a child task.
* Reorder the first sprint.
* Split a large task into smaller tasks before implementation.
* Make the visual direction more specific.
* Require more Slock research for a surface not yet observed deeply.

## Suggested Confirmation

Reply with one of:

* `确认，可以从 06-09-trellis-real-test-quality-gate 开始`
* `方向对，但先调整 first sprint`
* `先补更多 Slock 观察`
* `我要改任务范围`
