# Loading and actionable API failures are not visible

## Bug diagnosis capsule

| Field | Content |
| --- | --- |
| **1. Symptom** | Protected server routes have no root loading/error segment UI, and `apiGet` fallbacks can turn non-ok/network failures into believable empty collections. Expected: accessible themed loading, actionable error/retry, and explicit distinction between optional empty data and failed critical data. |
| **2. Evidence** | Intended RED on 2026-07-23: `rtk env NODE_ENV=test NEXT_PUBLIC_DEPLOYMENT_ENV=local-dev NEXT_PUBLIC_API_KEY= bun test test/delivery-ui-states.test.tsx` first failed because the shared state modules did not exist. Compile-only placeholders then produced four behavioral failures: critical GET always threw `critical GET not implemented`, timeout did not report `timed out`, route state markup was empty, and the route/lazy-boundary source contract was absent. |
| **3. Confirmed root cause** | Empty defaults were reused for both optional presentation resilience and user-actionable transport failures; route streaming/error ownership was never defined. |
| **4. Diagnostic strategy** | Add REDs for accessible loading/status, error alert/retry, themed shared primitives, strict critical fetches and dynamic component fallbacks. Exercise slow, non-ok, network and retry paths. |
| **5. Timeout strategy** | Slow probes use bounded delayed responses. A timeout transitions to actionable error rather than an infinite spinner or empty-success state. |
| **6. Warning strategy** | Reject claiming an error boundary fixes helpers that swallow errors, raw unthemed buttons, misleading zero counts during loading, or `ssr:false` changes that break server/client boundaries. |
| **7. User-visible correction** | Users see that data is loading, see why critical data failed, and can retry without mistaking a backend outage for an empty workspace. |
| **8. Acceptance** | Focused GREEN on 2026-07-23: the same command passed 4/4. Frontend regression then passed 168/168, plus `bun run lint` and `bun run typecheck`. Production build and `./twd` delayed/failure/recovery evidence remain required before this capsule is complete. |

## Implemented correction

- `apiGetCritical` now preserves HTTP detail and network failures, carries the account/Server headers, composes a caller abort signal with a finite timeout, and reports timeout distinctly. The existing `apiGet` remains the explicitly optional fallback path.
- the Tasks route uses the strict path for its task pages, channels, members and task-run templates; optional activity and memory panels retain their documented fallback behavior;
- root loading/error files delegate to shared Inkframe/token-backed components with `role=status`/`role=alert`, live regions and a working retry callback;
- the DnD board and chat Markdown/TaskBoard widgets are loaded through client boundaries with accessible, localized fallbacks; no Server Component uses `dynamic({ ssr: false })` directly.

## Remaining release evidence

- production-shaped `bun run build` after all Delivery/UI changes;
- a real worktree runtime with a deliberately delayed critical response and a recoverable critical failure;
- `./twd` DOM assertions and screenshot evidence in the supported theme states.
