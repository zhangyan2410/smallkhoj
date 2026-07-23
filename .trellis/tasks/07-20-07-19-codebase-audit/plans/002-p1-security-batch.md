# Plan 002: Batch-fix P1 authorization holes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 47848e8..HEAD -- backend/routers/public_api.py backend/routers/agent_api.py backend/routers/chat.py backend/services/llm.py backend/config.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S (per step) / M (whole plan, a day-ish)
- **Risk**: LOW–MED (one step touches the default-fail-open path used in dev)
- **Depends on**: `plans/001-pytest-baseline.md` (need `uv run pytest` working
  to verify each step)
- **Category**: security
- **Planned at**: commit `47848e8`, 2026-07-19

## Why this matters

Five independent authorization weaknesses were confirmed by direct code read.
Each one is small in isolation, but together they form an escalation chain:

1. Any logged-in member can rewrite another member's `permissions`/`backend`/
   `runtimeProvider` because `PATCH /members/{id}` skips the admin check that
   the sibling `DELETE` endpoint enforces.
2. The `_require_permission` gate **defaults to allow** when
   `member.config.permissions` is unset — which is the case for every agent
   created via the public agent-creation path. So the permission system is
   bypassable on the very accounts it's meant to constrain.
3. The better-auth bridge endpoint mints a fresh session for **any** supplied
   `userId` when `auth_bridge_secret` is empty and `debug=True` — and both are
   the shipped defaults in `config.py`.
4. The only auth on 70+ public-API routes is a hardcoded constant
   `PUBLIC_API_KEY = "sk_public_local"`, committed verbatim across 25+ tests.
5. The WebSocket chat endpoint has **no auth at all** and the LLM client
   hard-fails any `https_proxy` env the operator set.

These are defensive fixes (fail closed, require admin, rotate the secret) —
framed as code changes, no misuse detail. None of the fixes change the happy
path for legitimate callers.

## Current state

**`backend/config.py`** — defaults (full file excerpted, relevant lines):

```python
class Settings(BaseSettings):
    ...
    debug: bool = True                          # line 14
    auth_bridge_secret: str = ""                # line 15
    database_url: str = "postgresql+asyncpg://smallkhoj:smallkhoj@localhost:5432/smallkhoj"
    llm_api_key: str = ""
    llm_api_base: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"
    ...
```

**`backend/routers/public_api.py:107`** — static key constant:

```python
PUBLIC_API_KEY = "sk_public_local"
```

**`backend/routers/public_api.py:264-271`** — validator:

```python
async def verify_public_api_key(request: Request, db: AsyncSession = Depends(get_db)):
    key = request.headers.get("X-Public-Key") or request.query_params.get("api_key")
    if not key:
        raise HTTPException(401, "Missing API key: set X-Public-Key header or api_key param")
    if key == PUBLIC_API_KEY:
        return
    token_hash = hashlib.sha256(key.encode()).hexdigest()
    ...
```

**`backend/routers/public_api.py:3587-3615`** — `PATCH /members/{id}` lacks admin
check; the sibling `DELETE` at `3618-3626` calls `require_admin_role(context.membership)`:

```python
@router.patch("/members/{member_id}")
async def update_member(member_id: str, request: Request, _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db)):
    context = await _resolve_active_server_context(db, request)
    server = context.server
    member = await _resolve_member(db, server, member_id)
    if not member:
        raise HTTPException(404, "Member not found")
    body = await request.json()
    _apply_member_patch(member, body)    # writes permissions/backend/runtimeProvider
    ...
```

Compare `delete_member` at 3618-3626 which correctly does:

```python
context = await _resolve_active_server_context(db, request)
require_admin_role(context.membership)
```

**`backend/routers/agent_api.py:1265-1272`** — permission gate defaults to allow:

```python
def _require_permission(member: Member, permission: str) -> None:
    permissions = (member.config or {}).get("permissions")
    if permissions is None:
        return                # <-- DEFAULT-ALLOW: bypasses every gate
    if not permissions.get(permission):
        raise HTTPException(403, f"Permission denied: {permission}")
    if not permissions[permission]:
        raise HTTPException(403, f"Permission denied: {permission}")
```

**`backend/routers/public_api.py:418-426`** — debug-bypass on bridge secret:

```python
def _verify_auth_bridge_secret(request: Request) -> None:
    configured_secret = getattr(settings, "auth_bridge_secret", "") or ""
    provided_secret = (getattr(request, "headers", {}) or {}).get(AUTH_BRIDGE_SECRET_HEADER)
    if not configured_secret:
        if getattr(settings, "debug", False):
            return            # <-- FAIL-OPEN in debug (the default)
        raise HTTPException(503, "Auth bridge secret is not configured")
    if not provided_secret or not hmac.compare_digest(provided_secret, configured_secret):
        raise HTTPException(401, "Invalid auth bridge secret")
```

**`backend/routers/chat.py:11-33`** — WS endpoint has no auth:

```python
@router.websocket("/api/chat/ws")
async def chat_websocket(ws: WebSocket):
    await ws.accept()         # <-- no token/key check before accept
    try:
        while True:
            data = await ws.receive_json()
            content = data.get("q", "")
            ...
            async for token in chat_stream(content):    # burns settings.llm_api_key
                await ws.send_json({"type": "message", "content": token})
```

**`backend/services/llm.py:11-21`** — LLM client hard-codes `proxy=None,
trust_env=False`. The function's own comment says this is intentional
("绕过 http_proxy 环境变量") to avoid a `socksio` dependency. It is a
**documented tradeoff**, not a pure bug — but the tradeoff breaks documented
corporate-proxy deployments. The fix below makes it configurable rather than
removing the workaround.

## Commands you will need

| Purpose      | Command                                             | Expected on success |
|--------------|-----------------------------------------------------|---------------------|
| Tests        | `cd backend && uv run pytest -q`                    | exit 0              |
| Single test  | `cd backend && uv run pytest tests/test_<name>.py`  | exit 0              |

## Repo conventions to match

- Endpoint handlers in `public_api.py` use the signature
  `async def name(..., _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db))`
  — match it.
- Admin checks use `require_admin_role(context.membership)` from
  `routers/member_serialization.py`. Reuse it; do not invent a new helper.
- Settings live in `backend/config.py` as a `pydantic-settings` `BaseSettings`
  subclass with snake_case env names — new settings follow the same pattern.
- Tests use `pytest-asyncio` and `app.dependency_overrides[public_api.get_db]`
  to bypass real DB (see `backend/tests/test_chat_read_cursors_http.py`).

## Scope

**In scope** (the only files you should modify):

- `backend/config.py` — add `public_api_key` and `llm_disable_proxy` settings.
- `backend/routers/public_api.py` — Steps 1, 2, 3 (member PATCH admin check,
  static key → settings, drop debug-bypass).
- `backend/routers/agent_api.py` — Step 4 (permission default-deny).
- `backend/routers/chat.py` — Step 5 (WS auth gate).
- `backend/services/llm.py` — Step 6 (configurable proxy).
- New test files under `backend/tests/`:
  - `test_member_patch_admin.py` (Step 1)
  - `test_public_api_key.py` (Step 2)
  - `test_auth_bridge_secret.py` (Step 3)
  - `test_chat_ws_auth.py` (Step 5)

**Out of scope** (do NOT touch, even though related):

- `backend/routers/public_api.py:564-599` `_resolve_human_actor` impersonation
  (separate finding SECURITY-03, larger blast radius — defer to its own plan).
- `/auth/register` and `/auth/login` granting `owner` role (SECURITY-06) —
  product decision, defer.
- `TaskRunTemplate` cross-tenant IDOR (SECURITY-07) — needs schema change,
  defer to a migration-scoped plan.
- File-upload streaming cap (SECURITY-09) — defer; not in the escalation chain.

## Git workflow

- Branch: `advisor/002-p1-security-batch`.
- One commit per step, conventional-commit messages:
  - `fix(public-api): require admin role for PATCH /members`
  - `fix(public-api): source public API key from settings, not a literal`
  - `fix(auth-bridge): fail closed when secret is unset`
  - `fix(agent-api): default-deny when permissions map is unset`
  - `fix(chat-ws): require public API key on websocket handshake`
  - `feat(llm): make proxy bypass configurable`
- Do NOT push or open a PR unless the operator instructed it.
- Do NOT commit `.env` changes — secrets are operator-supplied.

## Steps

### Step 1: Require admin role for `PATCH /members/{member_id}`

In `backend/routers/public_api.py`, in `update_member` (line 3587), immediately
after `context = await _resolve_active_server_context(db, request)` add the
same check `delete_member` uses:

```python
context = await _resolve_active_server_context(db, request)
require_admin_role(context.membership)
server = context.server
```

**Self-edit carve-out (optional, lower risk to skip in v1)**: if the operator
wants non-admins to edit their own display name / avatar / status, add a branch
that allows the patch only when `member.id == context.membership.member_id`
AND the body contains none of `{permissions, actions, backend, runtimeProvider}`.
If unsure, do NOT add the carve-out — full admin-gating matches the sibling
endpoint and is the safer default.

**Verify**: write `backend/tests/test_member_patch_admin.py` that:
- Builds a minimal `app` with `public_api.get_db` overridden to a fake session
  (model after `test_chat_read_cursors_http.py`).
- Asserts PATCH with a non-admin membership returns 403.
- Asserts PATCH with an admin membership proceeds (returns 200 from the stub).

Then: `cd backend && uv run pytest tests/test_member_patch_admin.py -q` →
all pass.

### Step 2: Move `PUBLIC_API_KEY` to settings

In `backend/config.py`, add a field to `Settings`:

```python
public_api_key: str = "sk_public_local"   # dev default; override in production
```

In `backend/routers/public_api.py`:
- Replace `PUBLIC_API_KEY = "sk_public_local"` (line 107) with
  `PUBLIC_API_KEY = settings.public_api_key`.
- Keep the `key == PUBLIC_API_KEY` short-circuit at line 270 — it is now
  comparing against the configured value, not a hardcoded literal.

Add a startup warning in `backend/main.py` `lifespan` (after `await create_tables()`):

```python
if settings.public_api_key == "sk_public_local":
    logger.warning("public_api_key is the dev default; set PUBLIC_API_KEY in production")
```

(`logger` is already imported in `main.py` via the FastAPI/uvicorn stack; if
not, add `import logging; logger = logging.getLogger(__name__)` at module top
to match the pattern in `routers/public_api.py:105`.)

**Verify**: write `backend/tests/test_public_api_key.py` asserting:
- Request with no key → 401.
- Request with `X-Public-Key: <configured value>` → passes (200 from stub).
- Request with a wrong key → 401.

Then: `cd backend && uv run pytest tests/test_public_api_key.py -q` → all pass.

**Also**: `grep -rn '"sk_public_local"' backend/` and update the ~25 test
references that hardcode the literal to read from `settings.public_api_key`
(or a test fixture that sets it). Confirm no production-path test now fails.

### Step 3: Fail closed when `auth_bridge_secret` is empty

In `backend/routers/public_api.py:_verify_auth_bridge_secret` (line 418), remove
the debug-bypass branch:

```python
def _verify_auth_bridge_secret(request: Request) -> None:
    configured_secret = getattr(settings, "auth_bridge_secret", "") or ""
    if not configured_secret:
        raise HTTPException(503, "Auth bridge secret is not configured")
    provided_secret = request.headers.get(AUTH_BRIDGE_SECRET_HEADER)
    if not provided_secret or not hmac.compare_digest(provided_secret, configured_secret):
        raise HTTPException(401, "Invalid auth bridge secret")
```

(Also drops the `getattr(request, "headers", {}) or {}` defensive shroud —
Starlette `Request.headers` is always a `Headers` object.)

**Dev-experience note**: local development now requires `AUTH_BRIDGE_SECRET=...`
in `.env`. Update `backend/.env.example` (it already has a placeholder line
`AUTH_BRIDGE_SECRET=sk_auth_bridge_local_dev_secret_min_32_chars` — keep it,
just confirm it's ≥32 chars). Mention this in the commit message.

**Verify**: write `backend/tests/test_auth_bridge_secret.py` asserting:
- No `X-Auth-Bridge-Secret` header → 401 (when secret configured) or 503
  (when secret empty).
- Wrong secret → 401.
- Correct secret → passes.

Then: `cd backend && uv run pytest tests/test_auth_bridge_secret.py -q` → all pass.

### Step 4: Default-deny when `permissions` map is unset

In `backend/routers/agent_api.py:_require_permission` (line 1265), replace the
default-allow early return with a default-allow **list** so existing agents
keep working, but the "unset means allow-all" footgun is gone:

```python
# Members created before the permissions map existed (or without one) get
# this conservative default. Tighten per deployment via member.config.permissions.
_DEFAULT_AGENT_PERMISSIONS = {
    "sendMessage": True,
    "createTask": True,
    "claimTask": True,
    "updateTask": True,
    "fileWrite": True,
    "manageIntegration": True,
    "updateProfile": True,
}

def _require_permission(member: Member, permission: str) -> None:
    permissions = (member.config or {}).get("permissions")
    if permissions is None:
        permissions = _DEFAULT_AGENT_PERMISSIONS
    allowed = permissions.get(permission)
    if not allowed:
        raise HTTPException(403, f"Permission denied: {permission}")
```

Rationale: a hard default-deny would lock out every agent created before this
change ships (every agent currently has `permissions is None`). The explicit
allow-list preserves today's behavior while making "no map" mean "this safe
default set" instead of "everything." Tightening is then a per-member config
change, not a code change.

**Verify**: `cd backend && uv run pytest -q` → no regressions. Add a focused
test in an existing agent-api test file asserting that a member with
`config={"permissions": {"sendMessage": False}}` gets 403 on `sendMessage`.

### Step 5: Require public API key on the WebSocket handshake

In `backend/routers/chat.py`, gate the accept on the same key used by HTTP
routes:

```python
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from config import settings
from services.llm import chat_stream

router = APIRouter()


@router.websocket("/api/chat/ws")
async def chat_websocket(ws: WebSocket, api_key: str | None = Query(default=None)):
    if not api_key or api_key != settings.public_api_key:
        await ws.close(code=4401)  # application-defined: unauthorized
        return
    await ws.accept()
    try:
        while True:
            ...
```

Use a query param because browsers cannot set custom headers on the WebSocket
handshake. The frontend that uses this WS (if any — check `frontend/`) must
append `?api_key=...`; if no live consumer exists (see plan note on dead
`useChatWebSocket`), the gate is still correct as defense in depth.

**Verify**: write `backend/tests/test_chat_ws_auth.py` using
`starlette.testcode.TestClient` websocket connect:
- Connect without `?api_key` → receives close code 4401.
- Connect with wrong key → close 4401.
- Connect with correct key → handshake completes.

Then: `cd backend && uv run pytest tests/test_chat_ws_auth.py -q` → all pass.

### Step 6: Make the LLM proxy bypass configurable

In `backend/config.py`, add:

```python
llm_disable_proxy: bool = True   # preserve current behavior by default
```

In `backend/services/llm.py:get_llm_client`:

```python
def get_llm_client() -> AsyncOpenAI:
    """异步 OpenAI 兼容客户端。默认绕过 http_proxy 以避免 socksio 依赖；
    在需要走公司代理的部署里设置 LLM_DISABLE_PROXY=false。"""
    http_client = httpx.AsyncClient(
        proxy=None if settings.llm_disable_proxy else None,  # None = honor env
        trust_env=not settings.llm_disable_proxy,
    )
    return AsyncOpenAI(
        api_key=settings.llm_api_key,
        base_url=settings.llm_api_base,
        http_client=http_client,
    )
```

Note: when `llm_disable_proxy=True` (default), behavior is **identical** to
today. The change only adds an escape hatch for corporate-proxy deployments.

**Verify**: `cd backend && uv run pytest -q` → no regressions. (This step has
no new test; the change is a config knob with identical default behavior.)

## Test plan

- 4 new test files listed per step, each modeling after
  `backend/tests/test_chat_read_cursors_http.py` for the dependency-override
  pattern.
- One additional focused test for the permission default-list (Step 4).
- Full-suite run as the final gate.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd backend && uv run pytest -q` exits 0 (all pre-existing + new tests).
- [ ] `grep -n "PUBLIC_API_KEY = \"sk_public_local\"" backend/routers/public_api.py`
      returns no matches (constant now reads from settings).
- [ ] `grep -n "if getattr(settings, \"debug\", False)" backend/routers/public_api.py`
      returns no matches in `_verify_auth_bridge_secret` (debug-bypass removed).
- [ ] `grep -nA2 "def _require_permission" backend/routers/agent_api.py` shows
      the default-list logic, not `if permissions is None: return`.
- [ ] `grep -n "require_admin_role" backend/routers/public_api.py` shows the
      call inside `update_member` (the PATCH handler), not only `delete_member`.
- [ ] `backend/routers/chat.py` references `settings.public_api_key` and closes
      the socket on mismatch.
- [ ] `backend/config.py` defines `public_api_key` and `llm_disable_proxy`.
- [ ] `git status` shows only the in-scope files + new test files modified.
- [ ] `plans/README.md` status row for plan 002 updated to DONE.

## STOP conditions

Stop and report back (do not improvise) if:

- Any in-scope file no longer matches the "Current state" excerpts at the
  cited line numbers (drift since `47848e8`).
- Step 1's `require_admin_role` import is not in
  `routers/member_serialization.py` (the plan assumes it is, based on
  `delete_member`'s usage) — STOP and report the actual import location.
- Step 2 reveals that production deployments already override
  `PUBLIC_API_KEY` via a different mechanism (e.g. an env var with a
  different name) — do not silently introduce a second knob; report.
- Step 3 breaks a running production deployment because `AUTH_BRIDGE_SECRET`
  was relying on the debug-bypass — report; the operator may need a staged
  rollout that sets the secret before this code ships.
- The frontend actively consumes `/api/chat/ws` with a different auth scheme
  (cookie, not query param) — report; Step 5 may need to accept a session
  cookie in addition to the query param.

## Maintenance notes

For the human/agent who owns this code after the change lands:

- **Secret rotation**: any deployment using the literal `sk_public_local` in
  production must rotate `PUBLIC_API_KEY` to a generated value. The startup
  warning added in Step 2 is the canary.
- **`AUTH_BRIDGE_SECRET`**: local dev now requires it in `.env`. Update
  onboarding docs (root `README` / `AGENTS.md` if they mention backend setup).
- **Reviewer scrutiny**: the riskiest change is Step 4 (permission default).
  Confirm the `_DEFAULT_AGENT_PERMISSIONS` set matches what the product
  actually wants new agents to do — this is the one step with product-policy
  content, not just a fail-closed fix.
- **Follow-ups explicitly deferred** (out of this plan, recorded so they
  aren't lost): `_resolve_human_actor` impersonation (SECURITY-03),
  `/auth/register` owner role (SECURITY-06), `TaskRunTemplate` IDOR
  (SECURITY-07), file-upload streaming cap (SECURITY-09). Each needs its
  own scoped plan; do not bolt them onto this one.
