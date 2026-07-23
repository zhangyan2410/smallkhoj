import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  joinUrlPath,
  resolveChatWebSocketProtocols,
  resolveApiBase,
  resolveChatWebSocketUrl,
  resolvePublicApiKey,
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

test("production public API key configuration fails closed", () => {
  assert.throws(
    () => resolvePublicApiKey({ NEXT_PUBLIC_DEPLOYMENT_ENV: "production" }),
    /NEXT_PUBLIC_API_KEY/,
  )
  assert.throws(
    () => resolvePublicApiKey({
      NEXT_PUBLIC_DEPLOYMENT_ENV: "production",
      NEXT_PUBLIC_API_KEY: "sk_public_local",
    }),
    /NEXT_PUBLIC_API_KEY/,
  )
})

test("local development public API key fallback is explicit", () => {
  assert.equal(
    resolvePublicApiKey({ NEXT_PUBLIC_DEPLOYMENT_ENV: "local-dev" }),
    "sk_public_local",
  )
})

test("control plane statically reads public environment variables for Next client inlining", async () => {
  const source = await readFile(new URL("../lib/control-plane.ts", import.meta.url), "utf8")
  const websocketSource = await readFile(new URL("../hooks/use-websocket.ts", import.meta.url), "utf8")
  const productCreateSource = await readFile(new URL("../components/product-create-panel.tsx", import.meta.url), "utf8")

  assert.doesNotMatch(source, /resolve(?:PublicApiBase|PublicApiKey)\(process\.env/)
  assert.match(source, /NEXT_PUBLIC_API_BASE_URL:\s*process\.env\.NEXT_PUBLIC_API_BASE_URL/)
  assert.match(source, /NEXT_PUBLIC_WS_BASE_URL:\s*process\.env\.NEXT_PUBLIC_WS_BASE_URL/)
  assert.match(source, /NEXT_PUBLIC_API_KEY:\s*process\.env\.NEXT_PUBLIC_API_KEY/)
  assert.match(source, /NEXT_PUBLIC_DEPLOYMENT_ENV:\s*process\.env\.NEXT_PUBLIC_DEPLOYMENT_ENV/)
  assert.match(source, /INTERNAL_API_BASE_URL:\s*process\.env\.INTERNAL_API_BASE_URL/)
  assert.match(websocketSource, /resolveChatWebSocketUrl\(PUBLIC_RUNTIME_ENV\)/)
  assert.match(productCreateSource, /resolvePublicApiBase\(PUBLIC_RUNTIME_ENV\)/)
})

test("chat websocket keeps credentials in subprotocols and out of URL", () => {
  const key = "sk_rotated_key/with=symbols"
  const url = resolveChatWebSocketUrl(
    { NEXT_PUBLIC_WS_BASE_URL: "wss://smallkhoj.example.com" },
    "browser",
    "https://smallkhoj.example.com",
  )
  const protocols = resolveChatWebSocketProtocols(key)

  assert.equal(url, "wss://smallkhoj.example.com/api/chat/ws")
  assert.equal(url.includes(key), false)
  assert.equal(url.includes("api_key"), false)
  assert.deepEqual(protocols.slice(0, 1), ["smallkhoj.chat.v1"])
  assert.equal(protocols[1].startsWith("smallkhoj.public-key."), true)
  assert.equal(protocols[1].includes(key), false)
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
