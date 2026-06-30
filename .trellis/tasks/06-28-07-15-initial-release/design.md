# Initial release design notes

## Product Boundary

This task is a release-scope wrapper, not a single implementation unit. It should coordinate the smallest product loop that proves SmallKhoj's value:

`Feishu task entry -> SmallKhoj channel/task/TaskRun -> daemon runtime -> evidence/result -> Feishu/Jira write-back`

The release should prefer existing SmallKhoj concepts and surfaces over new abstractions. New code should be added only where the primary loop cannot be expressed with current channel, task, daemon, runtime, or evidence models.

## System Boundaries

- **External integrations:** Feishu and Jira should be treated as adapters around the SmallKhoj task/channel/TaskRun model, not as separate product silos.
- **SmallKhoj backend:** Owns webhook handling, auth/config storage, task/channel creation, runtime dispatch, evidence records, and external write-back orchestration.
- **SmallKhoj frontend:** Shows integration state, source links, owned work records, runtime status, result evidence, and clear failure reasons.
- **Daemon/runtime:** Executes or participates in work only after the backend has a stable Computer/runtime identity to target.
- **Deployment layer:** Provides stable public HTTPS endpoints for webhook testing and release use. Tencent Cloud Lighthouse is the first candidate target.

## Target Product Loop

1. A user mentions the SmallKhoj bot in Feishu with a task-oriented command.
2. The Feishu long-connection worker receives and normalizes the message.
3. Integration routing maps the Feishu chat/thread/user to a SmallKhoj channel, member, task template, and runtime target rule.
4. SmallKhoj creates a channel message, task, assignment, and TaskRun.
5. The backend delivers the TaskRun to the selected daemon/runtime through existing daemon WebSocket delivery.
6. The runtime executes the task and reports TaskRun lifecycle/evidence through existing agent API paths.
7. SmallKhoj writes a short result/status back to Feishu and writes the durable work result to Jira when the scenario requires it.
8. The frontend shows external source, runtime state, evidence, output, failure reason, and external write-back links.

## Integration Gateway Model

SmallKhoj should absorb the light parts of Agent Platform's channel gateway without creating a separate service in the first release.

Recommended model:

- `external_connectors`: one external system connection, such as Feishu app credentials or Jira site/API token.
- `external_routes`: maps an external chat/project/event shape to a SmallKhoj channel, task template, default assignee/runtime rule, and write-back policy.
- `external_events`: received/filtered/accepted/failed/completed evidence with source event ids, dedup keys, failure reason, and linked task/run ids.
- `external_sessions`: maps external chat/thread/topic ids to SmallKhoj channel/thread/task context.
- `external_mappings`: maps SmallKhoj task/run/message ids to Jira issue/comment ids and Feishu message/card ids.

The first implementation may hard-code some route behavior, but the model should make the future route/filter/template UI straightforward.

## Feishu Adapter Design

Feishu should be a task entry and orchestration surface, not a general chat assistant.

Use Multica's Lark/Feishu implementation as the primary reference:

- long connection instead of inbound public webhook;
- installation records with encrypted app secret;
- user binding from Feishu `open_id` to SmallKhoj member;
- chat/session binding from Feishu chat/thread/topic to SmallKhoj channel/thread context;
- inbound event dedup by Feishu event/message id;
- non-content audit for dropped events;
- group filter: only @bot, reply-to-bot, or selected command shapes enter SmallKhoj;
- typed outcomes: accepted, needs binding, offline runtime, archived/disabled target, dropped, infra error;
- outbound reply/card mapping for result and status updates.

MVP command examples:

- `@SmallKhoj 分析 JIRA-123`
- `@SmallKhoj 根据这段讨论创建 Jira issue`
- `@SmallKhoj 把这个任务交给 Mac-mini runtime 跑`
- `@SmallKhoj 跟进这个任务状态`

Non-goals:

- ingesting every group message;
- general-purpose assistant chat in Feishu;
- complete Feishu app suite;
- complex interactive cards before the basic task loop is reliable.

## Jira Adapter Design

Jira should start as an outbound REST integration, not a webhook-first integration.

MVP capabilities:

- configure Jira site URL and API token/credentials;
- read an issue by key;
- create an issue when the Feishu command asks for it;
- append a comment with TaskRun output and SmallKhoj evidence links;
- store `task/run/message <-> jira issue/comment` mapping.

Future Jira webhook ingestion can use the same connector/route/event model:

`Jira webhook -> external_event -> route filter -> SmallKhoj task/channel update`

This is intentionally deferred because Feishu long connection plus Jira outbound REST proves the release loop with less public-ingress and ICP filing risk.

## TaskRun Execution Boundary

Integration adapters should never execute provider/runtime work directly.

They should only:

1. normalize external input;
2. resolve member/channel/task context;
3. create or update task/channel state;
4. create or attach to a TaskRun;
5. write external event and mapping records;
6. send external status/write-back messages.

Runtime execution remains owned by SmallKhoj's existing daemon/runtime path:

`TaskRun -> daemon event -> local runtime -> slock/AgentProxy -> backend lifecycle/evidence`

This keeps Feishu/Jira integration from becoming a second execution system.

## Deployment Shape

Preferred long-term shape:

`Internet -> domain HTTPS -> reverse proxy -> frontend and backend containers -> PostgreSQL volume`

The reverse proxy should terminate HTTPS and route:

- frontend pages to the Next.js service;
- `/api/*` to the FastAPI backend;
- backend streaming/WebSocket endpoints with upgrade headers preserved;
- daemon WebSocket endpoint `/internal/agent-api/ws` with upgrade headers preserved.

The backend and frontend should not rely on `localhost` URLs in production. Public URLs should be explicit environment variables or same-origin routes.

For a Tencent Cloud Lighthouse instance in a Chinese mainland region, domain-based deployment must account for ICP filing before treating the domain as release-ready.

The initial release should not depend on inbound public webhooks for the main Feishu/Jira loop:

- Feishu uses long connection, so the server initiates outbound connectivity.
- Jira MVP uses outbound REST, so the server initiates outbound connectivity.
- Public HTTPS/tunnel/domain remains useful for UI demo, daemon public URL, and future webhook validation, but it is not the only way to prove the first release.

No-filing deployment cases:

- Tencent Cloud Chinese mainland server without a domain pointing to it: no ICP filing is needed for simply owning or testing the server by IP, but this is not a release-quality HTTPS/webhook setup.
- Tencent Cloud Hong Kong or non-mainland server: no ICP filing is needed for website/app hosting.
- Chinese mainland server plus domain-based public access: treat ICP filing as required before release use.

## Cost-Aware Public HTTPS Strategy

Do not replace the 99 RMB/year mainland server with an expensive overseas deployment just for validation. Use this order:

1. **Mainland host + free HTTPS tunnel.** Run SmallKhoj on the existing 2C2G mainland Lighthouse and expose only the webhook/API entry through a free tunnel such as Cloudflare Tunnel for validation.
2. **Mainland host + small Hong Kong gateway.** If the tunnel is unreliable, use the smallest monthly Hong Kong/non-mainland server as a reverse proxy or webhook gateway, while keeping the database and main control plane on the low-cost mainland host where practical.
3. **Full Hong Kong/non-mainland host.** Only run the full app outside mainland if cross-border access and webhook reliability require it.
4. **Formal mainland domain.** Continue ICP filing in parallel for the long-term domestic deployment, but do not make it the only path to validate the first release.

The gateway option must be measured by actual browser latency, daemon WebSocket stability, optional webhook success, and monthly traffic usage before committing to annual spend.

## Capacity Assumption

The current candidate Lighthouse instance is 2 vCPU / 2 GB RAM. Treat it as a low-cost control-plane host:

- suitable for FastAPI backend, Next.js frontend runtime, Caddy/Nginx, PostgreSQL, webhook traffic, and light operator usage;
- not suitable for local LLM inference, heavyweight agent execution, many concurrent runtime sessions, or memory-heavy on-server builds;
- production deployment should prefer prebuilt frontend/backend artifacts or prebuilt container images instead of compiling the full frontend on the server;
- add swap and basic memory monitoring before relying on the machine for release validation.

SSL certificate default:

- Use Caddy ACME automation or another free DV certificate mechanism for the first release.
- Do not purchase a paid one-year single-domain SSL certificate unless automatic issuance is blocked or the operator explicitly wants Tencent Cloud managed manual certificate deployment.
- Certificate availability does not replace ICP filing requirements for a Chinese mainland server.

Tencent Cloud automation:

- Use TencentCloud CLI (`tccli`) where it reduces manual console drift, especially for instance inspection, firewall rules, DNS/certificate checks, and repeatable deployment verification.
- Store Tencent Cloud SecretId/SecretKey only in local CLI configuration, environment variables, or CI secrets. Never commit cloud credentials or generated credential files.
- Keep CLI-backed deployment scripts idempotent where practical and document the expected region, instance id, domain, and ports.

## Reliability Contracts

- A local daemon reconnect should be idempotent for the same physical machine.
- A Feishu message/event should be idempotent by source event/message id.
- A Feishu group message should create SmallKhoj content only when the bot is explicitly addressed.
- Unbound or unauthorized external users should not leak message body into SmallKhoj channel/task content; they should produce audit-only records.
- A Jira write-back failure should not erase the local TaskRun result.
- External integration event state should be inspectable through durable records, not only process logs.
- Production URLs must use HTTPS/WSS for browser, webhook, and daemon paths.
- Tencent Cloud Lighthouse firewall rules must allow required ingress ports, normally 80/443 publicly and SSH restricted as much as practical.
- Backend CORS must allow the chosen frontend origin without opening uncontrolled wildcard credentialed origins.
- The deployed server must expose only the necessary public ports, normally 80/443 through the reverse proxy and SSH for administration.
- External webhook handlers should return clear failure modes for invalid auth, missing config, duplicate events, and downstream provider errors.
- UI status should be derived from durable backend state, not only transient client state.
- Each primary scenario run should leave enough evidence to debug without replaying from memory.

## Multi-Machine Control-Plane Design

The server exists to coordinate multiple daemon/runtime machines, not to execute all heavy work itself.

Control-plane server responsibilities:

- hold channel/task/TaskRun state;
- own external integration workers;
- track Computers, AgentWorkspaces, daemon leases, and runtime state;
- route TaskRuns to selected runtime targets;
- record evidence and external mappings;
- expose UI/control surfaces.

Daemon machine responsibilities:

- connect to backend with one physical-machine identity;
- maintain heartbeat and WebSocket event cursor;
- run selected runtime provider locally;
- execute TaskRun work through existing daemon/runtime pipeline;
- report lifecycle, output, token/context/tool evidence.

Multi-machine validation should cover:

- one physical machine should not create duplicate Computer records;
- multiple distinct machines can connect to the same control plane;
- target runtime selection sends a TaskRun to the intended machine;
- offline machines leave queued/blocked evidence instead of silent failure;
- reconnect resumes event delivery without duplicate execution.

## Scope Controls

- Use the existing channel/task/runtime vocabulary unless a concrete blocker proves a new model is needed.
- Keep integration config minimal and operator-readable.
- Do not block the release on visual redesign, minimap navigation, full MCP/skill surfacing, or complete admin settings.
- If a feature does not help the primary scenario enter, execute, explain, or write back, it should stay out of this release task.

## Frontend Art Direction Note

The user clarified a later frontend direction: if the current monochrome-leaning
look is kept, it must become a deliberate **water-ink / Shui-mo (水墨)** product
theme, not accidental black-and-white styling.

This is not a release blocker for the Feishu/Jira loop unless a frontend task
explicitly takes it on. The durable design contract lives in
`.trellis/spec/frontend/product-ui-style.md` under "Future theme: water-ink /
Shui-mo".

The short version for future frontend agents:

- Make it feel handmade and artful: xuan paper, blue-black ink, ink-wash layers,
  and a restrained cinnabar/mineral accent.
- Keep it operational: readable text, stable controls, clear channel/task/runtime
  state, no decorative splashes that hide information.
- Treat it as an explicit theme class/preference, not a broken token fallback.
- Preserve SmallKhoj's square ink-border frame language unless a later design
  decision replaces the whole system.

## Rollback / Degradation

- If full bidirectional Feishu/Jira flow is too heavy, keep one system as entry and the other as write-back evidence.
- If daemon execution is unstable, preserve the primary loop with hosted/runtime-provider execution while keeping daemon identity repair as a release blocker for local-machine flows.
- If the 2 GB RAM host becomes memory-bound, keep the domain/webhook/control-plane deployment on Lighthouse and move heavy execution/build work to local developer machines, CI, or external runtime providers.
- If external write-back fails, the SmallKhoj task should still retain the result and expose the write-back failure reason.
- If Feishu long connection is unavailable for the selected app type, fall back to temporary HTTPS tunnel/webhook for validation while keeping the adapter boundary unchanged.
