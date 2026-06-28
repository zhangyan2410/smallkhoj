# Initial release Feishu production worker runtime

## Goal

Add the backend runtime boundary that a deployable Feishu/Lark long-connection worker can use for the 7-15 release loop.

The worker/runtime layer should resolve the configured Feishu connector, Jira connector, creator member, credentials, HTTP clients, bot identity, and then call `services.feishu_event_loop.process_feishu_raw_event` for each raw Feishu message event. It must keep transport and dependency wiring separate from Feishu/Jira/TaskRun business logic.

## User Value

The current backend can process a raw Feishu event when all dependencies are manually passed in. That is not deployable. This task turns the service chain into a runtime shape that can be launched in a server process or worker process with environment configuration, without requiring frontend-only setup or hand-written Python snippets.

This directly supports the target initial-release slice:

```text
Feishu message
-> configured worker runtime
-> raw event loop
-> Jira lookup
-> SmallKhoj Task/TaskRun
-> accepted Feishu reply
-> terminal Jira/Feishu write-back
```

## Confirmed Facts

- `services.feishu_adapter` owns normalization, addressing, command parsing, event claim, route resolution, and external session creation.
- `services.feishu_event_loop` owns raw-event business composition: normalize, dispatch, release loop start, accepted reply, and release failure marking.
- `services.integration_runtime` already builds Jira write-back dependencies and Feishu reply dependencies from settings.
- `services.release_loop` requires a Jira connector object, Jira HTTP client, Jira credentials, and creator member id.
- `services.feishu_reply_orchestration` requires an HTTP client and `FeishuReplyConfig`.
- `ExternalConnector.config` may store non-secret fields such as Jira `siteUrl`; Jira and Feishu secrets must stay in environment/runtime inputs.
- Feishu long-connection mode avoids the immediate need for a public inbound webhook/domain during the first release.
- Reference evidence from `/Users/code/project/multica/server/internal/integrations/lark/`:
  - transport connectors should emit events into a dispatcher/service boundary rather than writing business state directly;
  - a placeholder/noop connector can make lifecycle wiring visible before real wire protocol is finished;
  - production WebSocket transport has shutdown, reconnect, and ACK-window constraints that should not be mixed into business logic.
- Current official Feishu/Lark docs and SDK references indicate long-connection workers are SDK/WebSocket based; SDK/channel details may evolve, so SmallKhoj should isolate SDK-specific code behind an injected transport boundary.

## Requirements

- **R1: Runtime settings.** Add safe settings for the single-instance release worker: Feishu connector id, Jira connector id, creator id, bot name/open id, Feishu app id/secret or future SDK credential inputs.
- **R2: Secret safety.** Do not store Jira API tokens, Feishu access tokens, Feishu app secrets, or SDK credentials in connector config, external events, tasks, mappings, `.trellis`, or committed env examples.
- **R3: Connector resolution.** Given runtime settings, load and validate the configured Feishu connector and Jira connector from the database.
- **R4: Credential resolution.** Reuse or extend `services.integration_runtime` so Jira credentials and Feishu reply config are runtime dependencies, not persisted connector data.
- **R5: Raw event handler wrapper.** Add a service operation that receives a raw Feishu event and runtime dependencies, opens/uses one DB session, delegates to `process_feishu_raw_event`, and returns a structured worker outcome.
- **R6: Transport boundary.** The worker runtime must not duplicate Feishu command parsing, route matching, Jira REST construction, TaskRun creation, or reply text construction.
- **R7: Testable worker lifecycle.** Provide an injected transport/consumer interface or connector runner that can be tested with fake events and without real Feishu network calls.
- **R8: Deployment visibility.** Missing config, missing connectors, disabled connectors, missing credentials, and event-loop failures must return stable reason codes for logs/health checks.
- **R9: Shutdown safety.** Any long-running runner added in this task must be cancellable and must close owned HTTP clients.
- **R10: Boundary safety.** The runtime layer must not execute daemon/runtime/model work directly.

## Acceptance Criteria

- [ ] Runtime settings expose empty safe defaults for Feishu worker connector ids, creator id, bot identity, and app credentials.
- [ ] Runtime dependency resolver returns structured missing-config outcomes before any event processing when required ids or credentials are missing.
- [ ] Resolver loads active Feishu and Jira `ExternalConnector` rows by id and rejects missing, wrong-provider, or disabled connectors.
- [ ] Worker event handler delegates exactly one raw event to `process_feishu_raw_event` with resolved connector ids, Jira connector, creator id, Jira credentials, Feishu reply config, HTTP clients, and bot identity.
- [ ] Worker handler closes owned HTTP clients on success and failure.
- [ ] Fake-transport tests can feed raw events without importing or connecting to a real Feishu SDK.
- [ ] Tests prove connector/runtime layer does not import daemon execution helpers or TaskRun creation helpers.
- [ ] Existing Feishu adapter, raw event loop, integration runtime, release loop, reply orchestration, and full backend tests pass.

## Out Of Scope

- Multi-replica Feishu WebSocket lease ownership.
- Full Feishu app installation / OAuth / tenant token lifecycle UI.
- Interactive cards and binding flows.
- A frontend integration settings page.
- Replacing `FEISHU_REPLY_ACCESS_TOKEN` with a complete tenant token cache.
- Running a live Feishu SDK connection in automated tests.

## Open Questions

No user decision blocks the first backend runtime slice. The deploy target may later choose whether this runner is launched as a separate process, a FastAPI lifespan task, or a process manager service. This task should keep that choice open by exposing a service/runner boundary rather than hard-coding a server startup hook.
