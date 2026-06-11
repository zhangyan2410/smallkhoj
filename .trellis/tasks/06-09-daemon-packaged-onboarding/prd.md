# daemon packaged onboarding

## Goal

Replace repo-path daemon commands with a product-grade packaged daemon onboarding flow.

## Requirements

* Define install/start command UX for macOS first.
* Keep connect-ticket security: browser shows one-time `sk_connect_...`, not machine token.
* Package or wrap daemon startup so users do not need repo internals.
* Add copy command, expiration, reconnect, troubleshooting, and version display.
* Document upgrade/update behavior.

## Acceptance Criteria

* [x] Computer onboarding command does not require navigating repo internals.
* [x] Token safety invariant is preserved.
* [x] User sees expiration and troubleshooting guidance.
* [x] Real connect/reconnect path is verified or blocked gaps are documented.

## Real Test SOP

Use marker `REAL_daemon_onboarding_<timestamp>`.

1. Generate connect command.
2. Verify command shape and token safety.
3. Run or dry-run packaged command if available.
4. Confirm daemon connect/register in API/trace.
5. Save evidence.

## Context

* Computers task: `.trellis/tasks/06-09-computers-product-detail/prd.md`
* Runtime spec: `.trellis/spec/backend/runtime-slock-integration.md`
