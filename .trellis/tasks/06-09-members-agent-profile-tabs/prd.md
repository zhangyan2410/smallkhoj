# members agent profile tabs

## Goal

Turn Members into a selected-member product surface with profile, permissions, agent DMs, reminders, workspace, apps, and activity tabs.

## Requirements

* Split members into Humans and Agents, with status/runtimes visible.
* Add selected-member detail layout.
* Add tabs: Message/Profile, Permissions, Agent DMs, Reminders, Workspace, Apps, Activity.
* Preserve agent creation and computer/runtime binding.
* Show profile fields, skills, permissions/actions, computer/workspace binding, backend/runtime.
* Provide editable permission/profile paths where backend supports them; otherwise create explicit follow-up tasks.
* Activity tab should summarize meaningful runtime/agent state, not only raw JSON.

## Acceptance Criteria

* [ ] Members page can select a human and an agent.
* [ ] Agent detail shows runtime/computer/workspace status.
* [ ] Tabs render stable layouts with useful empty states.
* [ ] Create Agent flow still works and the new agent appears in the list.
* [ ] Real WebDriver evidence verifies selected agent detail and API state.

## Real Test SOP

Use marker `REAL_members_<timestamp>`.

1. Open `/members`.
2. Create or select an agent with marker.
3. Verify the agent appears under Agents.
4. Open Profile, Permissions, Workspace, Activity tabs.
5. Cross-check `/api/v1/members` and `/api/v1/computers` where relevant.
6. Save screenshots/API evidence under `evidence/`.

## Context

* Existing code: `frontend/app/members/page.tsx`
* Parent research: `.trellis/tasks/06-09-product-maturity-gap-decomposition/research/slock-product-surface.md`
* Frontend specs: `.trellis/spec/frontend/`
