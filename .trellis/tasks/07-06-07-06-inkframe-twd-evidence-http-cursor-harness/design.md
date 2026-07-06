# Design: Inkframe TWD Evidence And HTTP Cursor Harness

## Summary

This task splits the remaining hardening into two independent but complementary
tracks:

1. **Browser evidence recovery**: prove or precisely block the `./twd` visible UI
   path.
2. **Backend HTTP harness**: move read-cursor route-flow coverage from direct
   handler calls to authenticated ASGI HTTP tests.

The browser track is dependent on a connected tab/extension. The backend track is
not, so backend hardening should continue even if browser proof remains blocked
on Chrome not running or user permission to launch Chrome.

## Browser Evidence Design

The browser stack has four layers:

```text
frontend/backend dev servers
-> ./twd bridge ports
-> browser extension/native host
-> connected product tab
```

Previous evidence shows the first three are mostly healthy except Chrome is not
running:

- frontend/backend are listening;
- `./twd` bridge ports are listening;
- extension and native host checks pass;
- no connected tab exists.

The diagnostic should therefore treat "no tab" as a real external-state blocker
unless Chrome can be launched with user permission and a tab connects afterward.

Browser proof must use `./twd` commands and must record:

- command;
- exact output;
- `tabId`;
- `tabUrl`;
- DOM assertion payload;
- screenshot path if captured.

## Browser Assertion Model

Use narrow DOM assertions rather than broad screenshots:

```js
return {
  path: location.pathname,
  deskBackground: !!document.querySelector('[data-region="app-desk-background"]'),
  chatMain: !!document.querySelector('[data-region="chat-main"]'),
  messageToggles: document.querySelectorAll('[data-slot="message-material-toggle"]').length,
  activeMessageCanvases: document.querySelectorAll(
    '[data-region="chat-main"] [data-owner-kind="message"] [data-slot="material-canvas"][data-mode="active"]'
  ).length,
}
```

For mobile:

```js
return {
  innerWidth,
  docClientWidth: document.documentElement.clientWidth,
  docScrollWidth: document.documentElement.scrollWidth,
  overflowing: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  composerVisible: !!document.querySelector('[data-region="composer"]')?.getBoundingClientRect().height,
}
```

Selectors may need adjustment to match current code, but evidence must remain
specific to product behavior.

## Backend HTTP Harness Design

The backend already has service and handler-level tests. This task should add a
small reusable HTTP test harness that can call public API routes through ASGI.

Preferred shape:

- use the existing app/router object if available in tests;
- use `httpx.AsyncClient` with `ASGITransport`, or an existing project test
  client pattern if already present;
- seed a real database/session fixture using current backend conventions;
- authenticate using the same account/session mechanism already used by public
  API tests;
- set active server context through the same cookie/header path used by the app.

The goal is not to re-test every service branch. The goal is to prove the full
route boundary for the cursor flows:

```text
HTTP request
-> auth/session dependency
-> active server/member dependency
-> route validation
-> read cursor service
-> persisted rows
-> HTTP response payload
```

## Backend Test Cases

Minimum tests:

1. `test_http_channel_cursor_post_and_get_projection`
2. `test_http_dm_cursor_post_and_get_projection`
3. `test_http_thread_cursor_post_and_get_projection`
4. `test_http_cursor_write_is_monotonic`
5. `test_http_cursor_rejects_cross_server_or_member_scope`
6. `test_http_cursor_rejects_channel_dm_kind_mismatch`
7. `test_http_unread_projection_uses_newer_message_rows_not_global_seq_gap`

If the current backend app has no practical full-auth fixture, the task should
first add a focused fixture rather than dilute the acceptance to source scanning.

## Data Boundaries

Read cursors are backend-owned metadata. Ink/material resources are not.

Do not add storage for material blobs in:

- backend;
- localStorage;
- IndexedDB.

## Review Boundary

A review can pass with browser proof still pending only if:

- the no-tab blocker is precise and current;
- no browser/mobile acceptance is claimed;
- backend HTTP harness work is meaningfully advanced and verified.

Otherwise browser claims require `./twd` evidence.
