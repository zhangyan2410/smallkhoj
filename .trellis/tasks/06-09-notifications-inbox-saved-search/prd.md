# notifications inbox saved search

## Goal

Build the supervisor attention layer: notification center, activity inbox, saved items, and global search.

## Requirements

* Add notification center entry to product shell.
* Add Activity inbox with filters for all/unread/mentions.
* Add Saved surface for saved messages/tasks/files.
* Add global search entry for channels, DMs, members, tasks, messages, files.
* Define unread/mention count contracts and backend gaps.
* Keep results actionable: click opens source context.

## Acceptance Criteria

* [ ] Notification center opens and shows recent events or empty state.
* [ ] Activity inbox can filter at least all/unread/mentions if data exists.
* [ ] Saved items surface shows saved marker message/task.
* [ ] Search can find a marker and open the result.
* [ ] Backend gaps are documented as child tasks if needed.

## Real Test SOP

Use marker `REAL_attention_<timestamp>`.

1. Send or create marker content.
2. Save the marker item.
3. Search marker globally.
4. Verify result opens source context.
5. Check notification/activity state where supported.
6. Save screenshots/API evidence.

## Context

* Product shell task: `.trellis/tasks/06-09-frontend-product-shell-and-navigation/prd.md`
* Chat task: `.trellis/tasks/06-09-chat-product-surface/prd.md`
