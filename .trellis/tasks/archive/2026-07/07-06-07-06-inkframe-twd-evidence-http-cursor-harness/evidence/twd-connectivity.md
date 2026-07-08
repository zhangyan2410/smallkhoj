# TWD Connectivity Evidence

Date: 2026-07-06

## Current Tab State

Command:

```bash
rtk ./twd --compact tabs
```

Result:

```json
{"ok": true, "tabs": [], "count": 0}
```

Interpretation:

- The `./twd` CLI runs.
- No browser tab is connected.
- Browser/mobile UI acceptance is still pending.

## Bridge And App Ports

Commands:

```bash
rtk lsof -nP -iTCP:18765 -sTCP:LISTEN
rtk lsof -nP -iTCP:18766 -sTCP:LISTEN
rtk lsof -nP -iTCP:3000 -sTCP:LISTEN
rtk lsof -nP -iTCP:8000 -sTCP:LISTEN
```

Observed state:

```text
Python PID 19960 listens on 127.0.0.1:18765
Python PID 19960 listens on 127.0.0.1:18766
node PID 19611 listens on 127.0.0.1:3000
python backend process listens on :8000
```

Interpretation:

- The WebDriver bridge ports exist.
- The local frontend and backend are running.
- The missing piece is a connected browser tab/extension client.

## Chrome Diagnostic

Chrome-control troubleshooting checks found:

```text
Google Chrome running: no
Google Chrome installed: yes
Codex Chrome Extension installed: yes
Codex Chrome Extension enabled: yes
Native host manifest correct: yes
```

The extension id checked was:

```text
hehggadaopoacecdllhhajmbjkdcmajg
```

The native host manifest check reported:

```json
{
  "exists": true,
  "nameMatches": true,
  "hasExpectedOrigin": true,
  "correct": true,
  "problem": null
}
```

## Current Blocker

Chrome is not running. Per Chrome-control safety rules, the agent cannot launch
Chrome without user permission.

No browser/mobile acceptance should be claimed until either:

- the user opens Chrome with the Codex Chrome Extension enabled and `./twd`
  reports a connected tab; or
- the user explicitly allows the agent to launch Chrome and the follow-up
  `./twd --compact tabs` succeeds.

## Next Browser Commands After A Tab Connects

```bash
rtk ./tools/twd-guard/twd-auth zy-ean
rtk ./tools/twd-guard/twd-open /chat
rtk ./tools/twd-guard/twd-open /tasks
```

Then save focused DOM JSON and screenshots under this task's evidence directory.
