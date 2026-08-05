import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import en from "../messages/en.json"
import zh from "../messages/zh-CN.json"

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8")

test("channel file deletion is server-authorized, strictly scoped, and collection-local", async () => {
  const [page, client] = await Promise.all([
    read("../app/(app)/chat/[channel]/page.tsx"),
    read("../app/(app)/chat/[channel]/channel-client.tsx"),
  ])

  assert.match(page, /activeServerId=\{session\.server\.id\}/)
  assert.match(page, /canManageServer=\{canManageActiveServer\(session\)\}/)
  assert.match(page, /canManageChannelMembers=\{canManageActiveServer\(session\)\}/)
  assert.doesNotMatch(client, /canManageActiveServer/)
  assert.match(client, /canManageServer \? \(/)
  assert.match(client, /!currentIsDm && canManageChannelMembers && \(/)
  assert.match(client, /remove-channel-agent-/)
  assert.doesNotMatch(client, /group-hover\/member:flex/)
  assert.match(client, /DestructiveActionDialog<ChannelMemberRemoveResult>/)
  assert.match(client, /markChannelMemberRemoved\(/)
  assert.match(client, /filterRemovedChannelMembers\(/)
  assert.match(client, /setMembers\(\(previous\) => previous\.filter/)
  assert.match(client, /void refreshMembers\(\)/)

  assert.match(client, /apiGetCritical<\{ files: ChannelFileItem\[\]; count: number \}>/)
  assert.match(client, /sessionToken,\s*activeServerId,\s*\{ signal: controller\.signal, timeoutMs: 15_000 \}/)
  assert.match(client, /apiDelete<unknown>/)
  assert.match(client, /isFileDeleteResult\(result, file\.id\)/)
  assert.match(client, /type: "fileRemoved"/)
  assert.match(client, /storageCleanup: result\.storageCleanup/)
  assert.match(client, /filesState\.phase === "error"/)
  assert.match(client, /filesState\.cleanupWarnings\.map/)
  assert.doesNotMatch(client, /setFiles\(/)

  const fileProjectionIndex = client.indexOf("projectChannelFileEvent(event")
  const genericProjectionIndex = client.indexOf("shouldHandleRealtimeEvent(event")
  assert.ok(fileProjectionIndex >= 0)
  assert.ok(genericProjectionIndex > fileProjectionIndex)
})

test("English and Chinese destructive-action copy stays complete and non-empty", () => {
  const commonKeys = ["close"] as const
  const taskKeys = [
    "deleteTask",
    "deleteTaskTitle",
    "deleteTaskConsequence",
    "deletingTask",
    "taskDeleteFailed",
    "taskDeleteInvalidResponse",
  ] as const
  const chatKeys = [
    "deleteFile",
    "deleteFileConsequence",
    "deletingFile",
    "fileDeleteFailed",
    "fileDeleteInvalidResponse",
    "filesLoadFailed",
    "filesLoadFailedDesc",
    "fileQuarantineWarningTitle",
    "fileQuarantineWarningDesc",
    "removeAgent",
    "removeAgentTitle",
    "removeAgentConsequence",
    "removingAgent",
    "removeAgentFailed",
    "removeAgentSucceeded",
  ] as const

  for (const key of commonKeys) {
    assert.ok(en.common[key].trim(), `en.common.${key}`)
    assert.ok(zh.common[key].trim(), `zh.common.${key}`)
  }
  for (const key of taskKeys) {
    assert.ok(en.tasks[key].trim(), `en.tasks.${key}`)
    assert.ok(zh.tasks[key].trim(), `zh.tasks.${key}`)
  }
  for (const key of chatKeys) {
    assert.ok(en.chat[key].trim(), `en.chat.${key}`)
    assert.ok(zh.chat[key].trim(), `zh.chat.${key}`)
  }

  assert.match(en.chat.fileQuarantineWarningDesc, /no longer accessible/i)
  assert.match(en.chat.fileQuarantineWarningDesc, /unfinished/i)
  assert.match(zh.chat.fileQuarantineWarningDesc, /已无法访问/)
  assert.match(zh.chat.fileQuarantineWarningDesc, /尚未完成/)
})
