# REAL_members_20260610T191011Z — Reviewer Evidence Packet

**Reviewer:** @minimax (task #6)
**Reviewed task:** `.trellis/tasks/06-09-members-agent-profile-tabs` (GLM1 @glm1)
**Marker:** `REAL_members_20260610T191011Z` (UTC, day 2026-06-10 19:10:11Z)
**Account:** @zy-ean (realtester-ui session, Slock Server)
**Tools used:** `twd.py` (project WebDriver), `curl` for `/api/v1/members` cross-check, `./smallkhoj-trace summary` for runtime cross-check.

> Reviewer note: Members page was rebuilt mid-review. The first inspection saw only the flat card grid from the previous cut; the second inspection (and all evidence below) ran against the tabbed detail surface. The notes focus on the new build because that is what will land in the PR.

## Pass / fail per acceptance criterion

| Criterion | Result | Evidence |
|---|---|---|
| Members page can select a human and an agent | PASS | Directory shows 2 humans (realtester-ui, zy-ean) and 5 agents (cctv, REAL_provider_runtime_20260611010223, glm1, minimax, kimi) plus the new test agent. Each row links to `/members?member=<uuid>&tab=profile`. Selected a human (realtester-ui, 66fccea1) and an agent (glm1, 5a7ea587) and the detail panel rendered both. |
| Agent detail shows runtime/computer/workspace status | PASS | glm1 Profile tab shows memberId short `5a7ea587`, computerId `c2b630e2`, workspaceId `92ffb2d6`, computer name `unregistered-computer`, status `online`, runtime `claude_code`, provider `Zhipu GLM`, PID 36287, session `270eb0ce`. Workspace tab adds OS `darwin 24.5.0 arm64`, daemon `0.2.0`, heartbeat `06/11 03:19`, agent workspace `running`, CWD, and a `DETECTED RUNTIMES` list (42, DeepSeek, Kimi, MiniMax, Zhipu GLM, cc, yier-gongyi). |
| Tabs render stable layouts with useful empty states | PASS | All 7 required tabs are present: Profile, Permissions, DMs, Reminders, Workspace, Apps, Activity. Each empty state names the data it would hold and points the user to the related surface ("Use the Chat page to view conversation history", "managed through the Control Plane dispatch", etc.). Tabs are URL-driven (`?tab=...`) so back/forward and sharing work. |
| Create Agent flow still works and the new agent appears in the list | PASS | Filled `name=REAL_members_20260610T191011Z-test-agent`, `computerId=c2b630e2-...`, submitted. New agent appeared in the directory (8th entry) and in `/api/v1/members` (id `9f8133df-760a-44dd-936f-afab8b49870f`, kind=agent, status=online, runtime bound to claude_code on unregistered-computer). The agent actually started — its profile page shows PID 76552 and the daemon session directory was created. |
| Real WebDriver evidence verifies selected agent detail and API state | PASS | All screenshots and API curls below. `twd.py` drove every tab and the create-agent submit; the new agent was confirmed in the backend API after the page revalidated. |

## Real Test SOP steps executed

1. Logged in as `realtester-ui`, tab 1617511184.
2. `twd.py goto http://127.0.0.1:3000/members` — landed on the directory (7 members).
3. Inspected Member Groups sidebar — confirmed `All: 7 / Humans: 2 / Agents: 5` totals and a per-member link list with `kind` labels.
4. `twd.py goto /members?member=5a7ea587-3b95-4057-a5ba-5d34c7e39938&tab=profile` — opened glm1's Profile tab. Verified display name, memberId/computerId/workspaceId, runtime binding, status pill, and skill list.
5. For each of Permissions / DMs / Reminders / Workspace / Apps / Activity: `twd.py goto` and a fresh `twd.py screenshot`. Every tab rendered with the expected heading and either populated content or a useful empty state.
6. Returned to `/members`, filled the Create Agent form, `twd.py click` on `button[type=submit]`. Page revalidated and the new agent appeared at the top of the agents section.
7. `twd.py goto /members?member=9f8133df-760a-44dd-936f-afab8b49870f&tab=profile` to verify the new agent has a populated detail page.
8. `twd.py goto /members?member=66fccea1-c167-4399-beab-e1b87bc8d376&tab=profile` to verify a human's detail page shows `computerId: unbound` and `workspaceId: unbound` (humans are not bound to a computer).
9. API cross-check via `curl -H "X-Public-Key: sk_public_local" /api/v1/members` — confirmed total grew from 7 to 8, marker agent `REAL_members_20260610T191011Z-test-agent` is present with kind=agent.
10. `./smallkhoj-trace summary` cross-check — all tab navigations returned 200 (in 500-1400 ms each); the `POST /members` for create-agent returned 303 redirect followed by the revalidated GET 200.

## Cross-layer data flow

Browser submit (Create Agent) → Next.js server action `createAgentAction` (`app/members/page.tsx:33`) → `fetch POST /api/v1/members/agents` with `serverApiHeaders` → backend `members/agents` route → DB write → `revalidatePath("/members")` → page re-renders with the new row. Tabs are pure server-rendered URL params (`?member=...&tab=...`) so no client-side state machine is required; the URL is the contract.

## Known gaps / opportunities

* **Tab visibility state**: the active tab is currently styled via the underline/border on the link itself, but there is no explicit `aria-current="page"` or `data-active="true"`. A keyboard / screen-reader user can navigate between tabs but doesn't get a distinct "you are here" signal. Recommend adding `aria-current="page"` to the active tab link.
* **Empty states are honest** but generic. They correctly point the user to the Control Plane / Chat surface, which is appropriate for now. If the parent product roadmap ships the per-member DMs/Reminders/Apps API, the empty states should grow into real lists.
* **Create Agent provider dropdown is overloaded** with raw `runtime / availability / model` strings (e.g. `"42 / available / deepseek-v4-pro"`, `"yier-gongyi / available / FILL_ME_AFTER_ADD"`). This is leaking internal data shape and one entry still has the literal placeholder `FILL_ME_AFTER_ADD`. The dropdown works, but the labels should be cleaned up to provider name only, with availability and model as secondary text or tooltips.
* **No agent from the new test agent list actually finished provisioning during the test window** — the directory showed it as `agent` and the profile page showed a live PID, but the provider remained `default` (not a chosen provider) and no DMs/Workspace data had loaded. That's expected for a brand-new agent; flagged here so the reviewer doesn't claim the full data path is populated.
* **Members page is still in the working tree as uncommitted modifications** (see `git status`). The reviewer did NOT clean these up — they belong to the implementer's PR.

## Evidence files in this directory

- `REAL_members_20260610T191011Z-00-glm1-profile.png` — glm1 Profile tab (existing agent).
- `REAL_members_20260610T191011Z-01-loaded-with-tabs.png` — full Members page first load with the tabbed detail visible.
- `REAL_members_20260610T191011Z-02-permissions.png` — Permissions tab empty state.
- `REAL_members_20260610T191011Z-03-workspace.png` — Workspace tab with bound computer, daemon heartbeat, agent workspace, detected runtimes.
- `REAL_members_20260610T191011Z-04-activity.png` — Activity tab with runtime state summary and session timeline.
- `REAL_members_20260610T191011Z-05-dms.png` — DMs tab empty state pointing to the Chat surface.
- `REAL_members_20260610T191011Z-06-reminders.png` — Reminders tab empty state.
- `REAL_members_20260610T191011Z-07-apps.png` — Apps tab empty state.
- `REAL_members_20260610T191011Z-08-create-form.png` — Create Agent form before submit.
- `REAL_members_20260610T191011Z-09-new-agent-created.png` — directory after submit, new agent listed.
- `REAL_members_20260610T191011Z-10-new-agent-profile.png` — detail page of the just-created agent.
- `REAL_members_20260610T191011Z-11-human-profile.png` — human (realtester-ui) detail page; computerId/workspaceId correctly shown as `unbound`.
- `REAL_members_20260610T191011Z-12-directory.png` — full Members directory.
- `REAL_members_20260610T191011Z-notes.md` — this file.
