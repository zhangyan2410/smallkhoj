# Initial release real-value product loop

## Goal

Shape the SmallKhoj initial release around one useful, demonstrable end-to-end product loop: work enters from Feishu or Jira, SmallKhoj turns it into an inspectable channel/task flow, an agent or local daemon runtime processes it, and the result is visible both inside SmallKhoj and back in the external work tool.

The release should prove that SmallKhoj solves a real collaboration problem, not that every planned platform surface is complete.

## Background

The current project has many active planning and implementation threads. The immediate risk is scope spread: adding more surfaces without one reliable product loop that can be deployed, explained, tested, and demonstrated.

The requested initial release direction is:

- It should have practical value in a real team workflow.
- It should connect to Feishu and Jira.
- It should use real scenarios to find and fix bugs.
- It should settle server, multi-machine daemon connectivity, public access strategy, and external integration readiness.
- It should avoid broad time-sliced scheduling in this task document.

Deployment and network candidate:

- The user has a Tencent Cloud Lighthouse trial server available for the initial release deployment target.
- The current candidate server is a low-cost Tencent Cloud Lighthouse plan: 2 vCPU / 2 GB RAM, about 99 RMB/year.
- This server should be evaluated first for public HTTPS webhook reachability before considering a different provider.
- If the Lighthouse instance is in a Chinese mainland region and the release uses a bound domain, Tencent Cloud documentation says ICP filing is required before domain access can be opened for website/service use.
- Tencent Cloud itself does not always require ICP filing: using a Chinese mainland server without resolving a domain to it does not require filing, and using a Tencent Cloud Hong Kong/non-mainland server for a website or app does not require ICP filing.
- The initial release should avoid making inbound public webhooks the only integration path. Prefer Feishu long connection and Jira outbound REST first, so the low-cost mainland server can validate the real product loop without waiting for ICP filing.
- Paid one-year single-domain SSL is not required for the first release by default. Prefer automated free DV certificates through Caddy/ACME or Tencent Cloud's free certificate path unless there is a concrete reason to buy a paid certificate.
- TencentCloud CLI (`tccli`) is a candidate tool for later deployment automation around Lighthouse inspection, firewall/DNS/certificate-adjacent operations, and repeatable environment setup. Cloud credentials must stay outside the repository.
- Cost constraint: do not spend thousands of RMB just to validate the initial release. Prefer the existing low-cost mainland server, free tunnel options, or a short-lived low-cost Hong Kong gateway if a non-mainland HTTPS endpoint is needed.

## Primary Scenario

A user triggers work from Feishu. SmallKhoj receives the message through Feishu long connection, creates or updates a channel/task, starts a TaskRun on a selected daemon-backed runtime, records evidence, and writes the result back to Feishu and/or Jira.

Jira is the first durable external work-record target: SmallKhoj should read Jira issues, create issues when useful, append result comments, and preserve mappings from SmallKhoj tasks/runs/messages to Jira issues/comments. Jira webhook ingestion is a later extension, not the first release blocker.

The loop should answer these operator questions at a glance:

- Where did this work come from?
- What channel/task owns it?
- Which agent or daemon runtime handled it?
- Is it queued, running, blocked, failed, or complete?
- What result was produced?
- Where was the result written back?
- If it failed, what is the human-readable reason and where is the trace?

## Directional Architecture

SmallKhoj should combine the strongest ideas from the reference projects without copying their full product shape:

- **Multica reference:** Feishu/Lark long connection, installation, user binding, chat binding, inbound dedup, audit, and reply/card workflow.
- **Agent Platform reference:** connector, route, event log, and external thread/session mapping as the integration gateway skeleton.
- **SmallKhoj core:** channel, task, TaskRun, daemon, Computer, AgentWorkspace, runtime lifecycle, and evidence surfaces remain the execution source of truth.

The initial release should therefore be:

`Feishu entry -> Integration Connector/Route/EventLog -> SmallKhoj Channel/Task/TaskRun -> daemon runtime -> TaskRun evidence -> Feishu/Jira write-back`

## Release Requirements

- **R1: Feishu task-entry loop.** SmallKhoj can receive a minimal Feishu command/message through long connection, map it to a channel/task, and send accepted/running/result/failure responses back to Feishu.
- **R2: Jira REST write-back loop.** SmallKhoj can read Jira issues and create or update Jira work in the minimal useful form: issue creation, issue lookup, comment write-back, or status evidence linking. Jira webhook ingestion is not required for MVP.
- **R3: Channel/task ownership.** External work must land in a visible SmallKhoj channel/task surface instead of disappearing into logs or raw webhook handlers.
- **R4: Agent/runtime execution visibility.** The UI must show enough execution state to know whether the work is waiting, running, complete, failed, or blocked on a daemon/runtime/provider issue.
- **R5: Single local Computer identity.** A physical local machine should not create multiple Computer records. Reconnect should reuse existing identity where appropriate, and onboarding should not offer a new-computer path when the current local Computer already exists.
- **R6: Deployable multi-machine control plane.** Server, environment variables, daemon WebSocket, and optional public HTTPS/tunnel endpoints must be stable enough for multi-machine daemon testing and external integration validation outside localhost.
- **R7: Evidence-first debugging.** The product should expose trace links, external source links, result links, and concise failure reasons for the primary scenario.
- **R8: Scenario-led bug fixing.** Bug fixing should be driven by the primary scenario and a small number of real scripts, not by broad exploratory clicking across every planned surface.
- **R9: Scope freeze for non-critical surfaces.** New UI ideas, broad redesign, full MCP/skill marketplace, conversation minimap, and general platform polish should not block this release unless they directly support the primary scenario.
- **R10: Production URL compatibility.** Backend CORS, frontend API base URLs, WebSocket URLs, daemon server URLs, and reverse-proxy routing must work under a real HTTPS domain, not only `localhost`.
- **R11: Integration gateway skeleton.** SmallKhoj should introduce or reserve the minimal connector/route/event/session/mapping model needed to keep Feishu/Jira integration out of ad hoc feature code.
- **R12: TaskRun as execution boundary.** Feishu/Jira events should create or update SmallKhoj channel/task state, then start or attach to a TaskRun. Runtime execution must happen through existing daemon/runtime delivery, not inside the Feishu/Jira adapter.
- **R13: Multi-machine validation.** The release must validate more than one daemon/computer path: reconnect, lease, target runtime selection, offline behavior, and evidence reporting should be exercised with repeatable scripts.

## Minimum Useful Scope

- Feishu integration may start with one command/event shape and one response path, but it should use long connection rather than requiring an inbound webhook.
- Jira integration may start with REST read/write and the smallest write-back that proves value, such as creating an issue or appending an analysis comment.
- The UI only needs the surfaces required to inspect the primary loop: channel/task, runtime/computer state, integration status, and evidence/result display.
- Error handling should prefer clear operator-facing reasons over raw JSON dumps.
- Deployment can be simple, but it must be repeatable and suitable for real webhook testing.
- The first deployment target is Tencent Cloud Lighthouse unless capacity, OS, firewall, domain filing, or HTTPS constraints make it unsuitable.
- The 2 vCPU / 2 GB RAM plan is acceptable for the initial release only if the server runs the control plane and integration/webhook workload, while heavy model inference, large builds, and high-concurrency agent execution stay off the server.
- Domain readiness includes DNS, HTTPS certificate issuance, and ICP filing status when the server is in a Chinese mainland region.
- If ICP filing becomes the critical-path blocker, the release should keep the low-cost Chinese mainland Lighthouse as a control-plane candidate but use a Hong Kong/non-mainland server, tunnel, or other temporary public HTTPS endpoint for pre-filing webhook validation.
- Preferred cost-aware rollout: keep the 99 RMB/year mainland Lighthouse as the main runtime/control-plane host; use a free HTTPS tunnel first for Feishu/Jira webhook validation; if tunnel reliability is insufficient, rent the smallest suitable Hong Kong/non-mainland gateway monthly rather than buying an oversized server.
- Choosing a non-`.com` domain does not bypass ICP filing for a Chinese mainland server. The domain suffix must be eligible for ICP filing, and the domain owner real-name information must match the filing subject.
- TencentCloud CLI may be used for repeatable cloud-side setup, but deployment must remain reproducible from documented commands and must not depend on untracked console-only state.

## Integration Concepts

- **External Connector:** stores one external system connection, such as Feishu app credentials or Jira site/API token.
- **External Route:** maps an external chat, command, Jira project, or event shape to a SmallKhoj channel, task template, assignee/runtime rule, and write-back policy.
- **External Event Log:** records received, filtered, accepted, failed, and completed external events with dedup keys and failure reasons.
- **External Session:** maps Feishu chat/thread/topic state to a SmallKhoj channel/thread/task context.
- **External Mapping:** maps SmallKhoj task/run/message records to Jira issue/comment and Feishu message/card records.

These concepts can be implemented incrementally. The first code slice may hard-code some route behavior, but the architecture should not bury external integration logic directly inside unrelated task/channel handlers.

## Related Existing Trellis Work

- `.trellis/tasks/06-23-daemon-connect-maturity-and-onboarding/` covers daemon connection maturity.
- `.trellis/tasks/06-26-daemon-single-local-computer-identity/` covers the single local Computer identity blocker.
- `.trellis/tasks/06-25-taskrun-config-templates/` covers TaskRun templates, role snapshots, output policy, and runtime evidence. This release should use that work as the execution boundary for Feishu-originated tasks.
- `.trellis/tasks/06-09-product-maturity-gap-decomposition/` contains broader product maturity decomposition; this release task should select from it, not inherit all of it.
- `.trellis/tasks/06-27-chat-conversation-minimap-navigator/` is useful later, but should remain outside this release unless message navigation becomes a direct blocker for the primary loop.

## Reference Project Evidence

- Multica has a full Feishu/Lark long-connection package under `/Users/code/project/multica/server/internal/integrations/lark/`. The useful patterns are installation records, encrypted app secret storage, user/chat binding, inbound message dedup, non-content audit for dropped messages, long-connection supervisor, and typed dispatcher outcomes.
- Agent Platform keeps external event ingestion in a separate channel gateway. The useful patterns are `connectors`, `routes`, `event_log`, and `thread_sessions` from `/Users/code/project/agent-platform/channel-gateway/`, plus route-level filtering before agent/session creation.
- SmallKhoj already has `Task`, `TaskAssignment`, `TaskRun`, `TaskRunTemplate`, `Computer`, `AgentWorkspace`, daemon lease, and daemon WebSocket delivery. The initial release should extend those existing concepts instead of creating a parallel execution engine.

## Confirmed Deployment Gaps

- `docker-compose.yml` currently exposes backend and frontend directly, with no reverse proxy, HTTPS, or domain-aware routing.
- `backend/main.py` CORS currently allows localhost origins only.
- `frontend/next.config.mjs` rewrites `/api/*` to `http://localhost:8000`, which is not suitable for a containerized or remote production environment without adjustment.
- `frontend/lib/control-plane.ts` defaults `NEXT_PUBLIC_API_BASE_URL` to `http://localhost:8000`; deployment needs an explicit public or same-origin API base strategy.
- `frontend/hooks/use-websocket.ts` currently uses `ws://localhost:8000/api/chat/ws`; deployment needs `wss://` or a derived URL under HTTPS.
- `smallkhoj-daemon` can derive `wss://.../internal/agent-api/ws` from an HTTPS server URL, so daemon public deployment is viable if backend WebSocket proxying is configured.

## Confirmed Runtime and Multi-Machine Assets

- `docs/p2-lan-daemon-registration-runbook.md` already validates remote daemon registration over a reachable network using a one-time connect token and `--runtime none`.
- `zy-think/architecture/daemon-architecture.md` documents daemon control, runtime startup, WebSocket manager, AgentProxy, warmup, activity reporting, and message/task delivery.
- `backend/routers/agent_api.py` already has daemon connect/register/heartbeat/shutdown and `/internal/agent-api/ws` event delivery.
- `backend/services/daemon_control.py` already provides daemon control envelopes and resumable event cursor logic.
- `backend/services/task_runs.py` already creates assignments/runs and serializes runtime evidence.

## Non-Goals

- Do not build a full Feishu app suite in the first release.
- Do not build a full Jira project management replacement.
- Do not build a generic Feishu chat assistant. Feishu is a task-entry and orchestration surface for selected commands, not a general-purpose conversation replacement.
- Do not require Jira webhook ingestion for MVP when Jira REST read/write can prove the primary scenario with less networking risk.
- Do not complete every active product maturity task.
- Do not perform a broad frontend redesign as part of this release.
- Do not build a full MCP/skill marketplace before the primary loop is reliable.
- Do not optimize for demo-only behavior that cannot survive real webhook and daemon reconnect testing.
- Do not write a day-by-day schedule in this task; planning should stay scope- and acceptance-driven.

## Acceptance Criteria

- [ ] A Feishu long-connection-triggered work item can enter SmallKhoj and become visible as a channel/task or equivalent owned work record.
- [ ] A Jira-linked work item can be read, created, or updated through SmallKhoj with a visible external link or evidence record.
- [ ] At least one end-to-end scenario runs from Feishu trigger to SmallKhoj TaskRun execution to Feishu/Jira write-back.
- [ ] Feishu integration drops or audits unbound users, group messages not addressed to the bot, duplicate messages, and unknown routes without creating task/channel content.
- [ ] Jira MVP uses outbound REST for read/write/comment and records local-to-external mappings.
- [ ] Feishu/Jira adapters do not execute runtime work directly; they create/update channel/task/TaskRun state and let daemon/runtime execute.
- [ ] The scenario can run against a deployed server/domain with HTTPS, not only localhost.
- [ ] Tencent Cloud Lighthouse is confirmed suitable or explicitly rejected with a concrete reason.
- [ ] The 2 vCPU / 2 GB RAM server is validated under the release workload, including backend, frontend, Postgres, reverse proxy, webhook requests, and daemon WebSocket connection.
- [ ] Server-side builds are avoided or proven not to exhaust memory; preferred release flow uses prebuilt artifacts/images or a controlled build step.
- [ ] The deployment decision records whether the Lighthouse region requires ICP filing before domain-based access.
- [ ] A low-cost fallback path exists if ICP filing is not complete by release validation: free HTTPS tunnel first, then small Hong Kong/non-mainland monthly gateway only if needed.
- [ ] Any Hong Kong/non-mainland option is evaluated for monthly cost, included traffic, cross-border latency, and whether it is used as the full app host or only as a webhook/reverse-proxy gateway.
- [ ] The deployed frontend and backend work under the chosen domain without localhost-only API or WebSocket assumptions.
- [ ] Reverse proxy, HTTPS certificate, backend WebSocket proxying, and daemon WebSocket proxying are verified.
- [ ] Daemon reconnect does not create duplicate local Computer records for the same physical machine.
- [ ] The UI hides or blocks new-computer onboarding when the current local machine already has a Computer identity.
- [ ] Multi-machine validation covers at least two daemon/computer paths or one physical + one simulated machine identity, including target runtime selection and offline behavior.
- [ ] The primary scenario exposes human-readable status and failure reasons in the product UI.
- [ ] Runtime/provider/daemon failures have trace or log evidence reachable from the operator workflow.
- [ ] Bug fixes are validated against the primary scenario scripts before being considered release-ready.
- [ ] Non-critical surfaces are explicitly deferred when they do not support Feishu/Jira, deployment, daemon identity, or primary scenario reliability.

## Open Questions

- Which external system should be the first complete path: Feishu-first, Jira-first, or one combined scenario using both? Recommended answer: Feishu-first for entry and notification, Jira as the first durable work-record write-back.
- What is the smallest Jira write-back that proves value for the first release: create issue, append comment, or update status? Recommended answer: append comment or create issue, whichever matches the first real scenario with less auth and workflow friction.
- Should the first public deployment use a real domain immediately or start with server IP plus temporary tunnel/proxy? Recommended answer: do not make public ingress the main path for Feishu/Jira MVP. Use Feishu long connection and Jira REST first; use tunnel/domain only for UI/demo or future webhook validation.
