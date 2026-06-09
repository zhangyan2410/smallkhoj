# Slock Product Surface Research

Captured with project WebDriver (`agent/daemon/webdriver/twd.py`) on 2026-06-09 from the user's logged-in Slock tab.

## Evidence Files

* `../assets/slock-current-computer.png`
* `../assets/slock-members-activity.png`
* `../assets/slock-tasks.png`
* `../assets/slock-chat.png`

## Global Shell

Slock's first-level navigation is icon-led and persistent:

* Search
* Chat
* Tasks
* Members
* Computers
* Notification center
* Settings

The shell is not a landing page. It opens directly into an operational workspace.

## Computers Surface

Observed page: `/s/zhangyan-ean/computer/...`

Visible structure:

* Computer list sidebar with registered computers and daemon versions.
* Detail header with computer name and connected status.
* Info section with OS, daemon version, update availability, detected runtimes, creation date.
* Detected runtimes include Claude Code, Codex CLI, Antigravity CLI, Kimi CLI, Copilot CLI, Cursor CLI, Gemini CLI, OpenCode, Pi, with installed/not-installed states.
* Agents on this computer section with select/create actions.
* Agent rows show agent name, runtime provider, online/stopped status, and stopped warning text.
* Agent workspaces section has a Scan action and empty guidance.
* Destructive action area requires explicit Delete Computer action and explains impact.

Product implication for SmallKhoj:

* Computers must be a product detail page, not only a connect-command utility.
* Runtime availability, install state, daemon version, update status, and workspace scan belong in the same operational view.
* Stopped agents should be visibly explained in user terms.

## Members Surface

Observed via Members nav and screenshot.

Visible structure:

* Agents and Humans sections in a left/member sidebar.
* Graph entry.
* Agent/member detail has tabs: Message, Profile, Permissions, Agent DMs, Reminders, Workspace, Apps, Activity.
* Activity diagnostics can expose detailed runtime lifecycle, thinking/output/tool calls, and connection status.

Product implication for SmallKhoj:

* Members needs a selected-member detail model with tabbed sub-surfaces.
* Activity should be summarized for humans but still allow deep diagnostics.
* Permissions, reminders, workspace, apps, and DMs are product surfaces, not just backend fields.

## Tasks Surface

Observed page: `/s/zhangyan-ean/tasks?view=list`

Visible structure:

* Global task count.
* Filters/toggles: Channel, Creator, Assignee, Board, List.
* Status groupings: TODO, IN PROGRESS, IN REVIEW, DONE, CLOSED.
* Task cards carry channel source, task number, title/content preview, and status action.
* Tasks are linked to real channel/DM activity, including task numbers and channel names.

Product implication for SmallKhoj:

* Tasks needs board/list parity and filtering.
* Task cards should be linked back to channel/message/thread source.
* Task status changes should feel like workflow, not just form patching.

## Chat Surface

Observed page: `/s/zhangyan-ean/dm/...`

Visible structure:

* Left workspace sidebar includes Activity, Saved, Channels, and Direct Messages.
* Conversation area has Chat / Tasks / Files tabs.
* Messages show sender, type/role, timestamp, content, links, and task conversion.
* Per-message controls include Reply in thread, Add Reaction, Save Message, and per-message menu.
* Composer supports text, attach image, attach file, and send.
* Task conversion appears as "As Task" in the message flow.

Product implication for SmallKhoj:

* Chat is the primary product surface and must integrate tasks/files/threads/saved/reactions.
* DM and channel navigation needs counts and sorting.
* The message composer and message actions need polished affordances and real browser tests.

## Visual Notes

Slock uses a strong black-border/brutalist style with bright accent colors. The user explicitly does not want this copied. SmallKhoj should borrow structural maturity, not visual styling.

Recommended SmallKhoj direction:

* cyan/blue primary palette
* calmer SaaS/workbench density
* subtle borders, compact lists, clear status chips
* icon-led controls with text only where command clarity needs it
* app-first screen, not a marketing hero

## Open Product Questions

* Should SmallKhoj prioritize Chat or Computers as the default landing route?
* How much raw runtime thinking/output should humans see by default versus behind diagnostics?
* Should task evidence become a first-class model or initially live in task `data`/attachments/activity?
