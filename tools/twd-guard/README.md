# TWD Guard

Project-level helpers for authenticated SmallKhoj browser verification through `./twd`.

Use these when a frontend page requires a local account session or when a target URL must be verified exactly after navigation:

```bash
./tools/twd-guard/twd-auth zy-ean
./tools/twd-guard/twd-open /tasks
./tools/twd-guard/twd-eval /tasks "return { path: location.pathname }"
```

The guard logs in through the local API, injects `smallkhoj_session`, starts `./twd serve` if needed, uses a narrow URL match, and fails when the final `pathname` or required query string does not match the requested target.

Defaults:

```bash
FRONTEND_BASE=http://127.0.0.1:3000
API_BASE=http://localhost:8000
PUBLIC_KEY=sk_public_local
TWD_ACCOUNT=zy-ean
TWD_WAIT=5
```
