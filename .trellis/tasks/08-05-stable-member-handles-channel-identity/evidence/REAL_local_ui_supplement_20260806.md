# Local UI/runtime supplemental acceptance — 2026-08-06

## Candidate

- Worktree: `/Users/code/project/smallkhoj`
- Branch / HEAD: `main` / `a7dc867fb367`
- Frontend: `http://127.0.0.1:3000`
- Backend: `http://127.0.0.1:8000`
- Exact authenticated Quark/TWD tab: `1617513010`
- Channel: `http://127.0.0.1:3000/chat/identity-test`
- Current locally built daemon: `0.2.6`, dynamic diagnostics endpoint
  `http://127.0.0.1:60049`
- Agent/runtime: `@open2`, OpenCode, running after the current `dist` daemon was
  reconnected with a fresh one-time reconnect command.

No source, database, Channel membership, Agent profile, or message mutation was
performed by the supplemental UI checks below. Temporary input values were
cleared and the locale was restored to `zh-CN`.

## PASS evidence

1. **Chinese-first Create Agent**
   - `zh-CN` was the initial locale.
   - Labels were `名字`, `电脑`, `描述（可选）`, `运行时`, `提供方`.
   - Desktop geometry was Name + Computer, full-width Description, Runtime +
     Provider.
   - `验收助手六` produced canonical preview `@验收助手六 · 可用`.
   - Reserved suffix `ean-s7k2m` produced the localized invalid-name message.
   - A 201-code-point Description produced `201/200` and
     `aria-invalid="true"`.

2. **English Create Agent**
   - Switching to `en` produced `Agent Name`, `Computer`,
     `Description (optional)`, `Runtime`, and `Provider`.
   - The expertise-oriented Description placeholder and helper text were fully
     localized; the existing runtime/provider controls remained present.

3. **Real composer suggestions**
   - Typing `@` opened one `role=listbox` containing exactly current Channel
     members `@张翰` and `@open2`.
   - The `@open2` row displayed `擅长后端排障和数据库迁移` as secondary Agent
     expertise text.
   - Keyboard selection inserted an atomic contextual reference plus a trailing
     separator without sending the message.
   - Typing `#` listed only `#identity-test` with its Channel description.
   - During `compositionstart`, an IME Enter left `@张` unchanged and did not
     select/send. After composition, normal `@张` input filtered to `@张翰`.

4. **English remove-Agent confirmation**
   - The authorized member panel showed an always-visible `Remove` action with
     `aria-label="Remove open2"`.
   - Opening the dialog (without confirming) rendered:
     `Remove open2 from #identity-test?` and explicitly stated that only the
     current Channel is affected, one final leave notice is delivered, and
     later send/receive in that Channel stops.

5. **Current daemon identity**
   - The previous daemon process predated the latest `dist` build and was
     replaced using the product reconnect flow.
   - The new daemon reported `Starting aaa-daemon v0.2.6`, connected its WebSocket,
     started `@open2`'s OpenCode runtime, and the Computers UI showed one online
     Computer and one running workspace.

6. **Unauthenticated signup/signin and invite return-to**
   - A separate cookie scope at `http://localhost:3000` avoided disturbing the
     authenticated `127.0.0.1` acceptance tab.
   - Sign In rendered only required email/password fields and no Name field.
   - Sign Up rendered a required `name` field plus email/password.
   - Both modes preserved `/join/fake-token` in the hidden `returnTo` value and
     in the Sign In/Sign Up mode link.
   - A malicious `//evil.example` return target normalized to `/` and was omitted
     from the mode link.

Existing screenshot/DOM evidence remains in:

- `REAL_create_agent_description_20260806.png`
- `REAL_channel_member_remove_reply_20260806.png`
- `REAL_channel_final.snapshot.txt`

## Still requiring user or separate real-device acceptance

- User-observed provider behavior for the current-build leave update: no visible
  acknowledgement reply, then no later delivery for the removed Channel.
- A true narrow viewport/touch run. TWD's one-shot CDP device override resets
  when the debugger detaches, so the existing source/unit layout contract was
  not misreported as a persistent real narrow-screen run.
- A second Channel check proving the removed Agent continues working there.
- The two-origin, same-Name Human collision in one real Channel (the PostgreSQL
  membership event and projection tests already prove the contract
  deterministically).
