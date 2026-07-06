# files surface and attachments

## Goal

Build the Files product surface and attachment workflows for chat/conversation contexts.

## Requirements

* Add Files tab/page for channel/DM conversation.
* Show uploaded/shared files with owner, time, source message, size/type.
* Add attach image/file composer affordances.
* Wire to backend file/attachment APIs where available.
* If backend upload is incomplete, document exact API/model gaps as child follow-up.
* Include safe file type/size UI errors.

## Acceptance Criteria

* [x] Files tab renders for a conversation.
* [x] Attachment controls are visible and accessible.
* [x] A supported upload path persists and appears in Files, or backend gaps are documented with a child task.
* [x] Source message links work.

## Real Test SOP

Use marker `REAL_files_<timestamp>`.

1. Open a channel/DM.
2. Upload or attach a small marker file if supported.
3. Verify message and Files tab show it.
4. Cross-check API/file metadata.
5. Save screenshot/API evidence.

## Context

* Parent research: `.trellis/tasks/06-09-product-maturity-gap-decomposition/research/slock-product-surface.md`
* Frontend quality: `.trellis/spec/frontend/quality-guidelines.md`
