# Auth Onboarding Contracts

> Frontend/auth contracts for Better Auth signup, login, email verification, and early-release account policy.

## Scenario: Signup Email Verification Policy

### 1. Scope / Trigger

Use this spec whenever work changes signup, login, account creation, team/server invite flows, Better Auth configuration, or production auth deployment env.

This is cross-layer because the product policy, Better Auth server config, frontend UX, database state, and external email provider must agree.

### 2. Signatures

Current auth config file:

```text
frontend/lib/auth.ts
```

Current Better Auth config shape:

```ts
export const authOptions = {
  database: betterAuthPool,
  secret: betterAuthSecret(),
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
  },
  plugins: [nextCookies()],
} satisfies BetterAuthOptions
```

Current required production env:

```text
BETTER_AUTH_SECRET
BETTER_AUTH_URL
BETTER_AUTH_DATABASE_URL
AUTH_BRIDGE_SECRET
```

Email verification requires adding both:

```ts
emailVerification: {
  sendOnSignUp: true,
  sendVerificationEmail: async ({ user, url, token }, request) => {
    // call the configured mail provider here
  },
}
```

and, when login must be blocked until verification:

```ts
emailAndPassword: {
  enabled: true,
  requireEmailVerification: true,
}
```

### 3. Contracts

- Current signup does not prove email ownership. `emailAndPassword.enabled: true` enables email/password signup and login, but it does not send verification email by itself.
- Do not show product copy or tests that imply email verification is active until `sendVerificationEmail` and provider env are configured.
- Better Auth email verification sends a tokenized verification URL through a project-provided email function. SmallKhoj must supply the mail provider integration.
- Registration-time verification email requires `emailVerification.sendOnSignUp: true`. Without it, signup does not automatically send a verification email.
- A numeric "verification code" or OTP-style signup is a different UX from Better Auth's default verification-link flow. If the product requires a code, implement or choose an OTP-capable provider/plugin explicitly.
- Requiring verification before login is a separate policy flag. Do not enable `requireEmailVerification: true` without a working `sendVerificationEmail` path.
- Email delivery needs an SMTP or email API provider. Provider credentials, sender domain, templates, and callback URLs are deployment env/secrets, not repo constants.
- Early internal testing may use unverified test accounts or admin-created accounts if the surface is not public/untrusted.
- Public beta, external team invites, or untrusted signup must choose one of:
  - configured email verification provider;
  - invite-only/admin-created accounts;
  - GitHub login;
  - WeChat scan login;
  - another explicit identity provider.
- If Tencent SES is used, expect domain/sender verification and usage-based billing. Do not assume email is free at scale.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| `sendVerificationEmail` is absent | Signup may create/login accounts, but email ownership is unverified. |
| `sendVerificationEmail` exists but `sendOnSignUp` is false/missing | Signup does not automatically send verification email. |
| `requireEmailVerification: true` is set without a provider | Signup/login flow is broken; block the change. |
| Verification provider env is missing in production | App startup or signup verification test must fail before release. |
| User tries to sign in before verifying when verification is required | UI handles the 403/error state and asks for verification. |
| Signup copy says "verification code sent" but no email provider is configured | Product bug; copy must be changed or provider implemented. |
| Public beta allows password signup without verification or invite controls | Release risk; requires explicit user/product approval. |

### 5. Good/Base/Bad Cases

- Good: internal test accounts are clearly treated as unverified test data.
- Good: adding verification includes provider env, sender domain setup notes, UI states, and tests.
- Base: email/password signup is enabled for controlled local/cloud testing with no verification copy.
- Bad: assuming Better Auth sends email automatically because email/password auth is enabled.
- Bad: promising a numeric email code while implementing only verification-link email.
- Bad: enabling `requireEmailVerification` without implementing `sendVerificationEmail`.
- Bad: hard-coding API keys, SMTP passwords, sender secrets, or callback URLs in tracked source.

### 6. Tests Required

For auth env/deployment changes:

- Frontend build with `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_DATABASE_URL`, and `AUTH_BRIDGE_SECRET`.
- Browser signup/login smoke on the target environment.
- Confirm product copy matches the active policy: no verification copy unless email is actually sent.

For email verification implementation:

- Unit/integration test that `sendVerificationEmail` is called with the expected user email and callback URL.
- Provider adapter test with secrets mocked.
- Signup test for unverified account state.
- Login test that unverified users are rejected when `requireEmailVerification` is true.
- UI test for "check your email", resend, expired/invalid token, and successful verification states.

### 7. Wrong vs Correct

#### Wrong

```text
emailAndPassword.enabled is true, so signup sends a verification code and the email is trusted.
```

#### Correct

```text
emailAndPassword.enabled only enables password auth. Email ownership is unverified until sendVerificationEmail plus provider env and verification policy are implemented.
```

## Scenario: Server Invite Join Links

### 1. Scope / Trigger

Use this spec whenever work changes Server invitations, invite acceptance, members onboarding, login return paths, or Server-switching behavior after login.

### 2. Contracts

- Server invitations are link-first until a real mail provider is configured. UI copy must say the user should copy and manually send the link; do not claim that an email, verification code, or notification was sent.
- Invite creation is an owner/admin action for the active Server. Members page invite controls should be visible only when the current account's active `server_memberships` role is `owner` or `admin`; the backend must still enforce the same rule.
- Opening `/join/<token>` may be unauthenticated for preview, but accepting the invite requires a logged-in account.
- Accepting an invite must not require the accepting account to already be a member of the invited Server. The accept action should call the invite acceptance endpoint directly, then set the active Server cookie from the returned Server id.
- After acceptance, the joined Server must appear in `/api/v1/auth/me.memberships`; the Server switcher should not need a separate invite-specific state model.
- If a logged-out user opens an invite, login/signup must preserve a safe same-origin `returnTo` path back to `/join/<token>`.

### 3. Tests Required

- Backend tests for invite creation authorization, hash-only token storage, valid accept, malformed/expired/revoked/consumed rejection, and idempotent reaccept by the same account.
- Frontend/source tests proving invite acceptance activates the returned Server id and invite UI does not imply email delivery.
- Browser evidence with two accounts: account A creates a link, account B accepts it, account B sees account A's Server in memberships/switcher.
- Browser evidence that a non-admin member does not see the invite creation action for a shared Server, while owner/admin can generate a copyable invite link.
