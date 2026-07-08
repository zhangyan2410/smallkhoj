# Runtime Gate Evidence

Marker: `REAL_TASKRUN_AUTOSTART_20260625005429`

## Setup

- Backend: `http://127.0.0.1:8000`
- Daemon: reconnected `integration-gate-mac` through a fresh connect ticket.
- Runtime: `@gate-minimax`, Claude Code via CC Switch provider `MiniMax`, model `MiniMax-M3`.
- Frontend evidence route: `/control/integration`

## TaskRun

- Task: `#3 REAL_TASKRUN_AUTOSTART_20260625005429`
- Task id: `fa8f091e-aa90-46f6-80cd-c771da72c8b8`
- Template: `research-analyst`
- Role key: `researcher`
- Prompt profile: `task.researcher`
- Auto-start: `true`
- Run id: `77c7e2ab-eae3-477d-9a80-9edf874739e8`
- Runtime session id: `f2df7719-e459-49e7-a429-74d144f8259b`

## Result

- Task status: `in_review`
- TaskRun status: `completed`
- Output message id: `b48cad2d-4092-4665-84a2-d393a9defc7a`
- Output message short id: `83ce8704`
- Output sender: `@gate-minimax`
- Output content includes `EXACT_MARKER: REAL_TASKRUN_AUTOSTART_20260625005429`
- Evidence issues: none

## Usage Evidence

- Input tokens: `9640`
- Output tokens: `2313`
- Cache read input tokens: `231978`
- Total tokens: `243931`
- Duration: `32285ms`
- Tool calls: `7`
- Tool results: `7`
- Context known tokens: `11953`
- Context window: `200000`
- Context occupancy: `0.059765`

## Browser Evidence

- `taskrun-templates.png`: `/control/taskrun-templates` rendered built-in templates and editor controls.
- `tasks-template-selector.png`: `/tasks` rendered TaskRun template selector.
- `control-integration-taskrun-autostart.png`: `/control/integration` rendered completed TaskRun, output, usage, context, and tool evidence.
