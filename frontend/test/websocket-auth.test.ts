import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  AGENT_WEBSOCKET_PROTOCOL,
  parseWebSocketAuthProtocols,
} from "../lib/daemon-auth"


test("agent websocket credentials are decoded from subprotocol headers", () => {
  const token = "sk_agent_value/with=symbols"
  const agentId = "agent-a"
  const encode = (value: string) => Buffer.from(value, "utf8").toString("base64url")
  const parsed = parseWebSocketAuthProtocols([
    AGENT_WEBSOCKET_PROTOCOL,
    `smallkhoj.bearer.${encode(token)}`,
    `smallkhoj.agent-id.${encode(agentId)}`,
  ].join(", "))

  assert.deepEqual(parsed, {
    authHeader: `Bearer ${token}`,
    agentId,
    selectedProtocol: AGENT_WEBSOCKET_PROTOCOL,
  })
})


test("agent websocket protocol parser rejects incomplete or malformed auth", () => {
  assert.equal(parseWebSocketAuthProtocols(AGENT_WEBSOCKET_PROTOCOL), null)
  assert.equal(
    parseWebSocketAuthProtocols(
      `${AGENT_WEBSOCKET_PROTOCOL}, smallkhoj.bearer.not*base64, smallkhoj.agent-id.YQ`,
    ),
    null,
  )
})


test("custom frontend websocket server no longer reads reusable auth from URL", () => {
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8")

  assert.equal(source.includes("parsedUrl.query.token"), false)
  assert.equal(source.includes("parsedUrl.query.agentId"), false)
  assert.equal(source.includes("Auth via query params"), false)
})
