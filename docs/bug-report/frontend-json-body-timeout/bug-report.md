# Successful JSON response bodies escaped the request timeout

## Bug diagnosis capsule

| Field | Content |
| --- | --- |
| **1. Symptom** | A destructive API request could receive successful HTTP headers and then remain pending forever while the JSON body stalled. The submitting dialog stayed non-dismissible. |
| **2. Evidence** | `apiRequestJson()` raced `fetch()` against the timeout, but returned `response.json()` without awaiting it inside `try`. The `finally` block therefore cleared the timer and removed the caller abort listener before body consumption completed. A synthetic 200 response with a never-ending body outlived a 75 ms watchdog despite `timeoutMs=5`. |
| **3. Confirmed root cause** | The timeout boundary covered only response headers, not the complete response body. JavaScript `return promise` did not delay this function’s `finally`; `return await`/an explicit race is required here. |
| **4. Diagnostic strategy** | Test a stalled successful body and a caller abort after headers, then keep the same abort promise alive through both success and error JSON parsing. |
| **5. Timeout strategy** | The caller’s existing finite `timeoutMs` remains the single bound; no second watchdog is added to production code. |
| **6. Warning strategy** | Do not make the destructive dialog dismissible while a mutation outcome is unknown and do not swallow body parse/abort errors as success. |
| **7. User-visible correction** | Destructive actions now leave the submitting state with a timeout/cancellation error even when the server stalls after sending headers. |
| **8. Acceptance** | A stalled 200 JSON body fails with the configured timeout and caller cancellation after headers propagates its reason; existing success/backend/network cases remain green. |

## Five-piece report

- **Reporter:** Delivery-critical independent review on 2026-07-23.
- **Reproduction:** Return a 200 `Response` whose readable body emits a JSON prefix and never closes.
- **Root cause:** The timer/listener cleanup ran before the un-awaited body promise settled.
- **Repair:** Race both success and non-success JSON parsing against the same abort promise and await the winning result inside the guarded `try`.
- **Verification:** RED was one watchdog failure plus one pending caller-abort test. GREEN is `5 passed` in `frontend/test/api-delete-request.test.ts`.
