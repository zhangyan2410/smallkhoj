# Initial release implementation outline

This outline is intentionally not a calendar schedule. It records the execution order and validation gates for the release scope.

## Work Streams

1. **Release scenario definition**
   - Use Feishu as the first task-entry surface.
   - Use Jira as the first durable external work-record/write-back target.
   - Write the scenario as a repeatable script with expected product-visible states.
   - Recommended scenario: `@SmallKhoj 分析 JIRA-123` -> read Jira -> create SmallKhoj task/run -> daemon runtime executes -> append Jira comment -> reply in Feishu.

2. **Integration gateway foundation**
   - Add or reserve connector/route/event/session/mapping concepts.
   - Keep the first implementation backend-contained; do not split a separate channel-gateway service yet.
   - Implement durable event logging before or alongside the first adapter so dropped/failed events are visible.
   - Add dedup support keyed by external event/message id.
   - Add minimal route resolution from external source to SmallKhoj channel/task template/runtime target.

3. **Jira REST MVP**
   - Configure Jira site URL and credentials outside source control.
   - Implement issue lookup by key.
   - Implement create issue or append comment, whichever best fits the primary scenario.
   - Persist local-to-external mapping for task/run/message to Jira issue/comment.
   - Surface auth/config/write-back failures in event log and product UI.

4. **Feishu long-connection MVP**
   - Configure Feishu app credentials outside source control; encrypt at rest when persisted.
   - Implement or adapt long-connection bootstrap/worker.
   - Normalize inbound message events into a SmallKhoj `ExternalWorkEvent`.
   - Implement dedup by Feishu event/message id.
   - Implement user binding or a controlled MVP binding rule.
   - Implement group filter: only @bot, reply-to-bot, or supported command shapes enter SmallKhoj.
   - Implement audit-only drop records for unbound users, unknown routes, non-addressed group messages, and duplicates.
   - Implement a basic Feishu reply path for accepted/running/result/failure.

5. **Feishu -> TaskRun -> Jira loop**
   - Parse the first supported Feishu command shape, such as `分析 JIRA-123`.
   - Read Jira issue context.
   - Create a SmallKhoj channel message, task, assignment, and TaskRun with a suitable template snapshot.
   - Route the TaskRun to the selected daemon/runtime using existing backend and daemon event delivery.
   - On TaskRun completion, append a Jira comment and reply to Feishu with a concise summary and links.

6. **Deployment and public access readiness**
   - Install/configure TencentCloud CLI locally if cloud-side automation is used; keep SecretId/SecretKey outside the repo.
   - Inspect the Tencent Cloud Lighthouse server: OS, CPU/RAM/disk, public IP, firewall/security group, open ports, and Docker availability.
   - Treat the current 2 vCPU / 2 GB RAM / low-cost annual plan as the first candidate and validate it with the actual release workload before upgrading.
   - Add swap and basic resource monitoring if the server remains the release target.
   - Avoid expensive on-server builds unless measured; prefer prebuilt images/artifacts for frontend/backend deployment.
   - Prefer `tccli` commands for repeatable cloud inspection and firewall/DNS verification when the target API is supported.
   - Decide the production domain and DNS target for the Lighthouse public IP.
   - Confirm whether the Lighthouse region/domain combination requires ICP filing before domain access can be used.
   - Validate public access in cost order: no inbound public webhook dependency first, free tunnel second, monthly Hong Kong/non-mainland gateway only if tunnel reliability is not enough.
   - If using a Hong Kong/non-mainland gateway, decide whether it hosts the full app or only proxies webhook/API/WebSocket traffic back to the mainland host.
   - Establish public HTTPS endpoint, environment configuration, and server startup path.
   - Add or configure a reverse proxy that handles HTTPS and WebSocket upgrade routing.
   - Remove or override localhost-only production assumptions in frontend/backend URL config.
   - Confirm browser UI, daemon WebSocket, Feishu long connection, and Jira outbound REST all work outside localhost.
   - Capture logs and trace handles for integration and daemon requests.

7. **Daemon and Computer identity hardening**
   - Implement or finish the single local Computer identity behavior.
   - Ensure reconnect is idempotent for one physical machine.
   - Hide or block new-computer onboarding when local identity already exists.
   - Validate recovery after daemon process stop/start.
   - Validate target runtime selection across more than one daemon/computer path.

8. **Product UI evidence path**
   - Show external source, owned channel/task, runtime/agent status, result, write-back state, and failure reason.
   - Keep raw identifiers secondary and copyable rather than dominant.
   - Add or reuse a compact event/evidence surface showing Feishu/Jira event status and linked TaskRun.

9. **Scenario-led bug bash**
   - Run the primary scenario repeatedly against the deployed environment.
   - Fix bugs that break entry, execution, evidence, write-back, daemon identity, or operator understanding.
   - Defer bugs from non-critical surfaces unless they block the release loop.

## Repeatable Validation Scripts

1. **Feishu ping entry**
   - Send `@SmallKhoj ping` or the chosen minimal command.
   - Expect: external event accepted, route resolved, Feishu receives confirmation, no TaskRun required unless configured.

2. **Feishu task creation**
   - Send `@SmallKhoj 创建任务: ...`.
   - Expect: channel message, task, assignment, event log, and Feishu confirmation appear.

3. **Feishu + Jira analysis**
   - Send `@SmallKhoj 分析 JIRA-123`.
   - Expect: Jira issue read, TaskRun created, runtime executes, Jira comment appended, Feishu summary returned.

4. **Daemon target routing**
   - Connect at least two daemon/computer paths where feasible, or one physical machine plus one simulated machine identity for controlled testing.
   - Assign a run to a selected runtime target.
   - Expect: only the target daemon receives execution work; non-target daemon remains idle.

5. **Offline daemon behavior**
   - Stop the target daemon and submit a Feishu-originated task.
   - Expect: task/run records a queued/blocked/offline state, Feishu receives a clear status, and UI exposes the reason.

6. **Reconnect/idempotency**
   - Restart the daemon and verify heartbeat, lease, and event cursor behavior.
   - Expect: no duplicate Computer for the same physical machine, no duplicate execution for the same external event.

7. **Jira write-back failure**
   - Use invalid Jira credentials or unreachable Jira URL in a controlled environment.
   - Expect: local TaskRun result remains available, external event/mapping records capture write-back failure.

## Validation Gates

- Backend tests cover external event normalization, dedup, route resolution, Feishu drop/audit cases, Jira config failure, and write-back failure where practical.
- Frontend verification uses `./twd` for the product-visible scenario states.
- Runtime verification uses `./smallkhoj-trace` or equivalent trace/log evidence.
- Deployment verification proves backend HTTP, frontend HTTP, browser-to-backend API calls, backend SSE/WebSocket, daemon WebSocket, Feishu long connection, and Jira REST paths work under the chosen deployment shape.
- A release candidate is not ready until the primary scenario succeeds after a fresh daemon restart and against the deployed server.

## Candidate Follow-Up Tasks

- Full integration settings UI.
- Full MCP/skill visibility and controls.
- Conversation minimap and message jump UI improvements.
- Broader product maturity backlog from `06-09-product-maturity-gap-decomposition`.
- Additional Feishu/Jira event types and workflow mappings.
- Jira webhook ingestion after REST MVP proves useful.
- Advanced Feishu interactive card patching after simple replies prove stable.
