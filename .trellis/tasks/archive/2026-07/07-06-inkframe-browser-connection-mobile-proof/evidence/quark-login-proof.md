# Quark TWD Login Proof

Date: 2026-07-06

## Summary

The Quark browser is connected to the project WebDriver bridge, but not on the
default `18765` bridge. Quark is connected to the Slock/Quark bridge at
`TWD_PORT=28765`.

This resolves the previous `blocked_no_tab` diagnosis for Quark-driven browser
testing. Future TWD commands in this local setup should use:

```bash
TWD_PORT=28765
```

## Commands And Results

Default bridge still has no tabs:

```bash
rtk ./twd --compact tabs
```

```json
{"ok": true, "tabs": [], "count": 0}
```

Quark bridge has connected tabs:

```bash
rtk env TWD_PORT=28765 ./twd --compact tabs
```

Result included:

```text
http://127.0.0.1:3000/login
```

Authenticated as `zy-ean`:

```bash
rtk env TWD_PORT=28765 ./tools/twd-guard/twd-auth zy-ean
```

```json
{"ok":true,"accountName":"zy-ean","tabUrl":"http://127.0.0.1:3000/login","result":{"hasCookie":true}}
```

Opened product routes:

```bash
rtk env TWD_PORT=28765 ./tools/twd-guard/twd-open /tasks
```

```json
{"ok":true,"target":"/tasks","tabUrl":"http://127.0.0.1:3000/tasks"}
```

```bash
rtk env TWD_PORT=28765 ./tools/twd-guard/twd-open /chat/gate-lab
```

```json
{"ok":true,"target":"/chat/gate-lab","tabUrl":"http://127.0.0.1:3000/chat/gate-lab"}
```

## DOM Evidence

Chat route:

```bash
rtk env TWD_PORT=28765 ./twd --compact eval --url-match 127.0.0.1:3000/chat/gate-lab "return { href: location.href, title: document.title, hasAppDesk: !!document.querySelector('[data-region=app-desk-background]'), messageCount: document.querySelectorAll('[data-message-id], [data-slot*=message], article').length, materialSurfaces: document.querySelectorAll('[data-inkframe-resource-id], [data-inkframe-background-source-mode], canvas').length }"
```

```json
{"href":"http://127.0.0.1:3000/chat/gate-lab","title":"Chat - SmallKhoj","hasAppDesk":true,"messageCount":360,"materialSurfaces":1}
```

Tasks route:

```bash
rtk env TWD_PORT=28765 ./twd --compact eval --url-match 127.0.0.1:3000/tasks "return { href: location.href, title: document.title, hasAppDesk: !!document.querySelector('[data-region=app-desk-background]'), taskToggles: document.querySelectorAll('[data-slot=task-material-toggle]').length, materialSurfaces: document.querySelectorAll('[data-inkframe-resource-id], [data-inkframe-background-source-mode], canvas').length, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth }"
```

```json
{"href":"http://127.0.0.1:3000/tasks","title":"SmallKhoj","hasAppDesk":true,"taskToggles":4,"materialSurfaces":1,"overflowX":0}
```

## Screenshots

- `evidence/screenshots/quark-chat-gate-lab-login-proof.png`
- `evidence/screenshots/quark-tasks-login-proof.png`

## Proof Runner Follow-Up

The canonical proof runner now reaches a connected browser, but currently fails
route assertions:

```bash
rtk env TWD_PORT=28765 ./tools/twd-guard/twd-inkframe-proof --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof --account zy-ean --json
```

Result:

```json
{"ok":false,"status":"failed_route"}
```

Reasons recorded by the runner:

- `/chat` redirects to `/chat/gate-lab`, but the guard currently expects exact
  `/chat`.
- Later route checks become ambiguous when both `/chat/gate-lab` and `/tasks`
  product tabs are open.
- `/tasks` checks did run and most product-shell/task selectors passed, but
  task controls markers reported `count=0`.

Evidence files produced by the runner:

- `evidence/twd-inkframe-proof.json`
- `evidence/twd-inkframe-proof.md`
