# `twd` Auto Port Discovery Bug Report

## Reporter

The operator reported on 2026-07-03 that the project `twd` CLI was unusable, and clarified that the fix must not hardcode a single default port because disconnects or reboots can change which bridge is active.

## Reproduction

Expected: running `./twd --compact tabs` without setting `TWD_PORT` should find the usable local WebDriver bridge and return connected browser tabs.

Actual: the command used the legacy `18765` default. A stale master was listening on `18765/18766`, but the active SmallKhoj browser extension connects to `28765`, so default `tabs` could return an empty tab list while `TWD_PORT=28765 ./twd --compact tabs` worked.

## Root Cause

The Python CLI encoded one default port at import time:

```python
DEFAULT_PORT = int(os.environ.get("TWD_PORT", "18765"))
```

The current SmallKhoj extension source `tmwd_slock_bridge/background.js` connects to `ws://127.0.0.1:28765`, while the legacy GA bridge uses `18765`. Because `twd` did not discover active bridge candidates, an old but empty legacy master could win by default and make browser verification look broken.

## Fix

`twd` now treats an omitted port as auto-discovery:

- `--port` wins when provided.
- `TWD_PORT` wins when set.
- Otherwise, candidate bridge ports are probed through HTTP control (`port + 1`) and the first candidate with connected sessions is selected.
- If no candidate has connected sessions, the first candidate is used so the SmallKhoj extension can connect when a new master starts.
- `TWD_PORT_CANDIDATES` can override the discovery order for local experiments.

The guarded helpers now also leave `twdPort` unset by default and start `./twd serve` in auto mode instead of assuming one fixed port.

## Verification

Automated:

```bash
python3 -m unittest agent/daemon/webdriver/test_twd_selection.py
node --test tools/twd-guard/twd-auth-guard.test.mjs
```

Real runtime:

```bash
./twd --compact tabs
```

Returned two connected tabs without setting `TWD_PORT`, after auto-starting/discovering the `28765` bridge.
