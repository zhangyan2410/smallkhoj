# REAL_integration_gate_restoration_20260729183621 Evidence

## Scope

- Task: `07-29-integration-gate-restoration`
- Route: `/control/gates`
- Marker: `REAL_integration_gate_restoration_20260729183621`
- Worktree: `/Users/code/project/smallkhoj-integration-gate-restoration`

## Browser Evidence

- Project WebDriver only: repository `./twd`; Playwright was not used.
- Authenticated tab id: `1617512813`.
- Final tab URL: `http://127.0.0.1:3000/control/gates`.
- Screenshot: `REAL_integration_gate_restoration_20260729183621-desktop.png`.
- Text snapshot: `REAL_integration_gate_restoration_20260729183621.snapshot.txt`.
- DOM assertions:
  - route pathname is `/control/gates`;
  - `data-region="integration-gate-summary"` is present;
  - `data-region="integration-gate-modes"` contains exactly seven `.sk-product-row` rows;
  - the real Foundation failure shows `DAEMON_NOT_CONNECTED · daemon-connect`;
  - duration text is present after the CLI timestamp fix;
  - the safe credential-free CLI example is visible;
  - `/control/integration` navigation is present;
  - no route error boundary is present;
  - the 1920×845 desktop document has no horizontal overflow.
- Locale assertions:
  - Chinese heading: `可重复集成门禁`;
  - English heading after locale-cookie switch: `Repeatable Integration Gates`;
  - English list title and `Failed` state rendered successfully.
- After restarting the dev server to invalidate the message-bundle cache, the final verification log contained only successful `GET /control/gates 200` requests and no `MISSING_MESSAGE` or route error.

The connected TWD bridge acknowledged CDP viewport override commands but did not change `innerWidth`; therefore no duplicate desktop image is labeled as mobile evidence.

## Real Gate Evidence

- A real `foundation-only` smoke was run twice against the local feature frontend, current backend, and explicit Server id resolved from the authenticated account.
- The account token stayed in process-local shell variables and was neither printed nor added to evidence.
- Command contract: `node tools/integration-gate/run.mjs --mode foundation-only --server-id <resolved-server-id> --api-base http://127.0.0.1:8000 --frontend-base http://127.0.0.1:3000 --daemon-rpc-base http://127.0.0.1:60818`.
- Result: honest failure, `FAIL foundation-only 3/12`.
- Primary failure: the selected Server tenant did not expose a connected daemon/runtime workspace (`DAEMON_NOT_CONNECTED`); downstream runtime/context/session checks consequently failed.
- This is preserved in `.runtime/integration-gate/latest/foundation-only.json` and rendered by the UI. The runtime store is intentionally gitignored.

## Automated Quality Evidence

- Integration Gate: `39/39` passing.
- Frontend: `213/213` passing.
- Frontend ESLint: passing with no warnings.
- Frontend TypeScript: passing.
- Frontend production build: passing with explicit build-only placeholder configuration; `/control/gates` emitted as a dynamic route.
- Daemon: build plus complete suite, `268/268` passing.
- `git diff --check`: passing.

## Result

Pass. The repo-owned models, CLI, runtime control, atomic persistence, hostile-data read boundary, localized visual route, and browser navigation are verified. The real Foundation smoke failed only because the explicitly selected Server had no connected daemon/runtime evidence; the failure is structured, persisted, and visible as required.
