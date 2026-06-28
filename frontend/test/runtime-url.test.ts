import assert from "node:assert/strict"
import test from "node:test"

import {
  joinUrlPath,
  resolveApiBase,
  resolveChatWebSocketUrl,
  resolvePublicApiBase,
  resolvePublicApiBaseFromHeaders,
  resolveWebSocketBase,
} from "../lib/runtime-url"

test("resolveApiBase keeps browser deployments same-origin by default", () => {
  assert.equal(resolveApiBase({}, "browser"), "")
})

test("resolveApiBase uses internal backend URL for server-side fetches", () => {
  assert.equal(
    resolveApiBase({ INTERNAL_API_BASE_URL: "http://backend:8000/" }, "server"),
    "http://backend:8000",
  )
})

test("resolveApiBase prefers explicit public API override", () => {
  assert.equal(
    resolveApiBase({
      NEXT_PUBLIC_API_BASE_URL: "https://smallkhoj.example.com/",
      INTERNAL_API_BASE_URL: "http://backend:8000",
    }, "server"),
    "https://smallkhoj.example.com",
  )
  assert.equal(
    resolveApiBase({ NEXT_PUBLIC_API_BASE_URL: "https://smallkhoj.example.com/" }, "browser"),
    "https://smallkhoj.example.com",
  )
})

test("resolveWebSocketBase derives same-origin websocket URLs", () => {
  assert.equal(resolveWebSocketBase({}, "browser", "https://smallkhoj.example.com"), "wss://smallkhoj.example.com")
  assert.equal(resolveWebSocketBase({}, "browser", "http://localhost:3000"), "ws://localhost:3000")
})

test("resolveChatWebSocketUrl supports explicit websocket override", () => {
  assert.equal(
    resolveChatWebSocketUrl(
      { NEXT_PUBLIC_WS_BASE_URL: "wss://ws.smallkhoj.example.com/base/" },
      "browser",
      "https://smallkhoj.example.com",
    ),
    "wss://ws.smallkhoj.example.com/base/api/chat/ws",
  )
})

test("resolveChatWebSocketUrl falls back to localhost outside the browser", () => {
  assert.equal(resolveChatWebSocketUrl({}, "server"), "ws://localhost:8000/api/chat/ws")
})

test("resolvePublicApiBase uses browser origin for deployed same-origin pages", () => {
  assert.equal(
    resolvePublicApiBase({}, "browser", "https://smallkhoj.example.com"),
    "https://smallkhoj.example.com",
  )
})

test("resolvePublicApiBase keeps localhost backend for Next dev pages", () => {
  assert.equal(resolvePublicApiBase({}, "browser", "http://localhost:3000"), "http://localhost:8000")
})

test("resolvePublicApiBaseFromHeaders derives reverse proxy public origin", () => {
  const requestHeaders = new Headers({
    "x-forwarded-host": "smallkhoj.example.com",
    "x-forwarded-proto": "https",
  })

  assert.equal(resolvePublicApiBaseFromHeaders({}, requestHeaders), "https://smallkhoj.example.com")
})

test("joinUrlPath avoids duplicated slashes", () => {
  assert.equal(joinUrlPath("https://smallkhoj.example.com/", "/api/v1/events"), "https://smallkhoj.example.com/api/v1/events")
  assert.equal(joinUrlPath("", "/api/v1/events"), "/api/v1/events")
})
