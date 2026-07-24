# Compacted PostgreSQL notifications lost Server identity

## Bug diagnosis capsule

| Field | Content |
| --- | --- |
| **1. Symptom** | A Server-scoped browser event larger than the PostgreSQL NOTIFY payload limit reached subscribers attached to the writer process, but subscribers on other backend workers silently discarded it. |
| **2. Evidence** | A 9 KB `message.created` envelope was compacted to a small payload with no top-level or payload `serverId`. The authenticated SSE filter requires one of those values to equal the selected Server, so cross-process delivery failed authorization. The minimal fallback dropped the same field and the adapter did not re-check its final byte size. |
| **3. Confirmed root cause** | `_compact_notify_event()` and `_minimal_notify_event()` treated tenant identity as discardable payload detail even though it is an authorization field at the fanout boundary. |
| **4. Diagnostic strategy** | Reproduce both compaction stages with oversized envelopes, inspect the serialized NOTIFY payload, and assert the exact identity fields used by the downstream SSE filter. Add a third case whose identity alone cannot fit the minimal envelope. |
| **5. Timeout strategy** | No runtime wait is required; serialization and size validation are pure, bounded unit tests. |
| **6. Warning strategy** | Do not fix delivery by weakening the SSE Server filter or by trusting only channel scope. Preserve tenant identity in every fallback and reject an envelope that remains oversized. |
| **7. User-visible correction** | Large events remain visible to the correct Server across backend workers and remain unavailable to foreign Servers. |
| **8. Acceptance** | Compact and minimal envelopes retain matching top-level/payload `serverId`; an unrepresentable identity fails before `pg_notify`; the full public-events suite and Ruff pass. |

## Five-piece report

- **Reporter:** Delivery-critical independent review on 2026-07-23.
- **Reproduction:** Serialize an event with a 9 KB body through `PostgresNotifyPublicEventFanout.notify_statement()` and inspect the compact result.
- **Root cause:** Tenant identity was omitted from both size-reduction fallbacks.
- **Repair:** Preserve `serverId` in both envelope locations and enforce the payload limit again after minimal serialization.
- **Verification:** RED was two missing-key failures plus one missing oversize rejection. GREEN is `3 passed` for the focused regressions, `20 passed` for `backend/tests/test_public_events.py`, and Ruff green for implementation/tests.
