# settings and admin

## Goal

Build Settings/Admin surfaces for server, user, runtime defaults, feature flags, and safety controls.

## Requirements

* Add Settings route in product shell.
* Show account/server basics.
* Add runtime defaults and provider defaults where supported.
* Add feature flag/admin safety controls for experimental product areas.
* Link API keys, daemon onboarding, and debug/SOP resources.
* Use clear disabled states for not-yet-supported settings.

## Acceptance Criteria

* [x] Settings route renders product-grade sections.
* [x] At least one setting is persisted or all unsupported settings are explicitly scoped.
* [x] Links to API keys/onboarding/debug docs are available.
* [x] Admin/destructive controls require confirmation.

## Real Test SOP

Use marker `REAL_settings_<timestamp>`.

1. Open Settings.
2. Change a supported marker setting or verify disabled states.
3. Refresh and verify persistence.
4. Save browser/API evidence.

## Context

* Product shell task: `.trellis/tasks/06-09-frontend-product-shell-and-navigation/prd.md`
* Frontend specs: `.trellis/spec/frontend/`
