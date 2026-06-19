# trellis real test quality gate

## Goal

Make real browser/runtime verification part of Trellis workflow for SmallKhoj tasks, so product-facing work is proven through the actual app, backend, daemon, and runtime path instead of only synthetic tests.

## Requirements

* Update Trellis workflow/spec docs to require real test SOP for browser-facing and runtime/control-plane tasks.
* Use project WebDriver `agent/daemon/webdriver/twd.py`; do not use Playwright for browser/UI verification.
* Define evidence storage conventions under each task directory.
* Require unique markers for real tests.
* Define cross-check expectations: visible DOM, backend/API state, DB state where relevant, trace output, runtime/agent replies.
* Add a concise SOP template that child tasks can copy.
* Keep this usable for non-developer product debugging, not just agent debugging.

## Acceptance Criteria

* [x] `.trellis/workflow.md` or relevant Trellis spec docs mention the real-test quality gate.
* [x] Frontend quality guidelines mention `twd.py` evidence for browser workflows.
* [x] Backend/runtime guidelines mention cross-layer proof for runtime/user-visible bugs.
* [x] A reusable SOP template exists.
* [x] Existing `docs/real-runtime-dm-reply-sop.md` is referenced or harmonized.

## Real Test SOP

This task is mostly documentation, but verify the SOP commands:

1. Run `agent/daemon/webdriver/twd --compact tabs`.
2. Confirm at least the local app tab can be discovered or document setup steps.
3. Run `./smallkhoj-trace summary` if available.
4. Save command outputs into task evidence notes.

## Context

* Draft: `.trellis/tasks/06-09-product-maturity-gap-decomposition/real-test-sop-integration.md`
* Existing SOP: `docs/real-runtime-dm-reply-sop.md`
* Project rule: `AGENTS.md`
* Specs: `.trellis/spec/backend/runtime-slock-integration.md`, `.trellis/spec/frontend/quality-guidelines.md`
