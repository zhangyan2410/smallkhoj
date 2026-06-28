# Initial release Feishu reply orchestration design

## Boundary

Add `backend/services/feishu_reply_orchestration.py`.

Responsibilities:

- Send accepted confirmation after `start_feishu_jira_analysis`.
- Send terminal result/failure replies for Feishu-originated TaskRuns.
- Discover Feishu context from `ExternalEvent.normalized`:
  - `chatId`
  - `messageId`
- Reuse `services.feishu_replies.send_feishu_text_reply`.
- Return structured outcomes.

Non-responsibilities:

- Feishu long-connection worker.
- Feishu tenant token acquisition/cache.
- Jira write-back.
- Runtime/daemon execution.

## Accepted Reply

Input:

- `FeishuDispatchOutcome` from the adapter.
- `ReleaseLoopStartResult` from release loop.
- Injected `http_client` and `FeishuReplyConfig`.

Behavior:

- Require accepted outcome with linked event.
- Use event normalized `chatId` and `messageId`.
- Send text such as:
  `Accepted JIRA-123. SmallKhoj task/run has been created.`
- Map local type `external_event` to Feishu reply message id.

## Terminal Reply

Input:

- `TaskRun`
- Injected `http_client` and `FeishuReplyConfig`
- Optional explicit output text.

Behavior:

- Find linked `ExternalEvent` by `task_run_id`.
- Use event normalized `chatId` and `messageId`.
- Skip if `task_run -> feishu message` mapping already exists.
- Load output message content when `TaskRun.output_message_id` exists and no explicit output text is supplied.
- Completed text uses output content or fallback `TaskRun completed without visible output.`
- Failed/cancelled text uses `failure_reason` or fallback.
- Map local type `task_run` to Feishu reply message id.

## Outcome Shape

Statuses:

- `sent`
- `skipped`
- `failed`

Reason codes:

- `FEISHU_REPLY_SENT`
- `FEISHU_REPLY_ALREADY_SENT`
- `FEISHU_REPLY_NO_SOURCE_CONTEXT`
- `FEISHU_REPLY_SEND_FAILED`
- `FEISHU_REPLY_UNSUPPORTED_OUTCOME`
- `FEISHU_REPLY_UNSUPPORTED_TASK_RUN_STATUS`

## Failure Handling

Feishu send failure returns `failed`; it should not roll back TaskRun/Jira/local state. Later worker/router integration can decide where to surface the failed outcome.
