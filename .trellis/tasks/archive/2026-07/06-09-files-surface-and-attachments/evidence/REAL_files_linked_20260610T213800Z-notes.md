# REAL files linked upload verification 2026-06-10T21:38:00Z

## Marker

`REAL_files_linked_20260610T213800Z`

## API evidence

Uploaded a text file through the public browser-session endpoint:

```json
{
  "id": "0b6e941e-ac8b-4155-b795-a5f227b45f93",
  "originalName": "REAL_files_linked_20260610T213800Z.txt",
  "messageId": "6c04ecc4-84b0-4479-8a3f-2fa69e383064",
  "channelId": "ad75051e-d984-46d5-8f4c-2e49817de778",
  "url": "/api/v1/attachments/0b6e941e-ac8b-4155-b795-a5f227b45f93/download"
}
```

`GET /api/v1/files?channelId=ad75051e-d984-46d5-8f4c-2e49817de778` returned the linked file with the expected `messageId`.

## Browser evidence

Project WebDriver (`agent/daemon/webdriver/twd.py`) was used.

* `REAL_files_linked_20260610T213800Z-02-files-linked-loaded.png`
  * Chat `/chat/all`, Files tab.
  * DOM showed `2 files`, including `REAL_files_linked_20260610T213800Z.txt`.
  * Linked row showed `Open message` and `Download`.
* `REAL_files_linked_20260610T213800Z-03-open-source-message.png`
  * Clicked `Open message`.
  * UI switched back to Chat tab and source marker message was visible.

## Current verdict

PASS. The files surface now has a public upload path, persisted file listing, download route, and source-message link for message-linked files.
