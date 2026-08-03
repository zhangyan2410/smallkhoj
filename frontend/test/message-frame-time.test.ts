import assert from "node:assert/strict"
import test from "node:test"

import { parseBackendUtcTime } from "../components/message-frame"

// 后端消息 time 字段是 UTC 墙上钟（"YYYY-MM-DD HH:MM:SS"，无时区标记）。
// 修复前直接 new Date(value) 被当作浏览器本地时区解析，非 UTC 机器上
// 聊天时间整体偏移（其它用 ISO createdAt 的地方不受影响）。
test("parseBackendUtcTime treats bare wall-clock strings as UTC", () => {
  const parsed = parseBackendUtcTime("2026-08-03 08:27:05")
  assert.ok(parsed)
  assert.equal(parsed.toISOString(), "2026-08-03T08:27:05.000Z")
})

test("parseBackendUtcTime keeps ISO strings with explicit zone as-is", () => {
  const zoned = parseBackendUtcTime("2026-08-03T08:27:05Z")
  assert.ok(zoned)
  assert.equal(zoned.toISOString(), "2026-08-03T08:27:05.000Z")

  const offset = parseBackendUtcTime("2026-08-03T16:27:05+08:00")
  assert.ok(offset)
  assert.equal(offset.toISOString(), "2026-08-03T08:27:05.000Z")
})

test("parseBackendUtcTime rejects empty and unparseable values", () => {
  assert.equal(parseBackendUtcTime(""), null)
  assert.equal(parseBackendUtcTime("   "), null)
  assert.equal(parseBackendUtcTime("not-a-date"), null)
})
