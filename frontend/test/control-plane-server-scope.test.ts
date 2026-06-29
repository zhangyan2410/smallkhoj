import assert from "node:assert/strict"
import test from "node:test"

import {
  ACTIVE_SERVER_COOKIE_NAME,
  apiHeaders,
  browserActiveServerId,
} from "../lib/control-plane"

function withDocumentCookie(cookie: string, callback: () => void) {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document")
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { cookie },
  })
  try {
    callback()
  } finally {
    if (originalDocument) {
      Object.defineProperty(globalThis, "document", originalDocument)
    } else {
      Reflect.deleteProperty(globalThis, "document")
    }
  }
}

test("browserActiveServerId reads the selected Server from a cookie", () => {
  withDocumentCookie(`${ACTIVE_SERVER_COOKIE_NAME}=server-a; smallkhoj_session=token`, () => {
    assert.equal(browserActiveServerId(), "server-a")
  })
})

test("apiHeaders attaches X-Server-Id from the active Server cookie", () => {
  withDocumentCookie(`${ACTIVE_SERVER_COOKIE_NAME}=server-b; smallkhoj_session=token`, () => {
    assert.deepEqual(apiHeaders(null, true), {
      "Content-Type": "application/json",
      "X-Public-Key": "sk_public_local",
      "X-Server-Id": "server-b",
      "X-Account-Token": "token",
    })
  })
})

test("apiHeaders can use an explicit active Server id for server-side callers", () => {
  assert.equal(apiHeaders("token", false, "server-c")["X-Server-Id"], "server-c")
})
