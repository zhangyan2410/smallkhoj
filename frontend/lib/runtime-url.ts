export type RuntimeKind = "browser" | "server"

export type RuntimeUrlEnv = {
  NEXT_PUBLIC_API_BASE_URL?: string
  INTERNAL_API_BASE_URL?: string
  NEXT_PUBLIC_WS_BASE_URL?: string
  NEXT_PUBLIC_API_KEY?: string
  NEXT_PUBLIC_DEPLOYMENT_ENV?: string
  NODE_ENV?: string
} & Record<string, string | undefined>

const LOCAL_API_BASE = "http://localhost:8000"
const LOCAL_WS_BASE = "ws://localhost:8000"
const DEVELOPMENT_PUBLIC_API_KEY = "sk_public_local"
const CHAT_WEBSOCKET_PROTOCOL = "smallkhoj.chat.v1"
const CHAT_WEBSOCKET_KEY_PROTOCOL_PREFIX = "smallkhoj.public-key."

function cleanBaseUrl(value?: string) {
  const trimmed = value?.trim()
  if (!trimmed) return ""
  return trimmed.replace(/\/+$/, "")
}

function currentRuntime(): RuntimeKind {
  return typeof window === "undefined" ? "server" : "browser"
}

function currentOrigin() {
  return typeof window === "undefined" ? undefined : window.location.origin
}

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || ""
}

function isLocalNextDevOrigin(origin: string) {
  try {
    const url = new URL(origin)
    return (url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.port === "3000"
  } catch {
    return false
  }
}

export function joinUrlPath(base: string, path: string) {
  const cleanBase = cleanBaseUrl(base)
  const cleanPath = path.startsWith("/") ? path : `/${path}`
  if (!cleanBase) return cleanPath
  return `${cleanBase}${cleanPath}`
}

export function resolvePublicApiKey(env: RuntimeUrlEnv = process.env) {
  const deployment = env.NEXT_PUBLIC_DEPLOYMENT_ENV?.trim()
    || (env.NODE_ENV === "development" || env.NODE_ENV === "test" ? "local-dev" : "production")
  const configured = env.NEXT_PUBLIC_API_KEY?.trim() || ""
  if (deployment === "local-dev") {
    return configured || DEVELOPMENT_PUBLIC_API_KEY
  }
  if (!configured || configured === DEVELOPMENT_PUBLIC_API_KEY) {
    throw new Error(
      "NEXT_PUBLIC_API_KEY must be configured with a non-development value for production builds",
    )
  }
  return configured
}

function base64UrlEncode(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

export function resolveChatWebSocketProtocols(publicApiKey: string) {
  return [
    CHAT_WEBSOCKET_PROTOCOL,
    `${CHAT_WEBSOCKET_KEY_PROTOCOL_PREFIX}${base64UrlEncode(publicApiKey)}`,
  ]
}

export function resolveApiBase(
  env: RuntimeUrlEnv = process.env,
  runtime: RuntimeKind = currentRuntime(),
) {
  const publicBase = cleanBaseUrl(env.NEXT_PUBLIC_API_BASE_URL)
  if (publicBase) return publicBase
  if (runtime === "browser") return ""
  return cleanBaseUrl(env.INTERNAL_API_BASE_URL) || LOCAL_API_BASE
}

export function resolvePublicApiBase(
  env: RuntimeUrlEnv = process.env,
  runtime: RuntimeKind = currentRuntime(),
  origin = currentOrigin(),
) {
  const publicBase = cleanBaseUrl(env.NEXT_PUBLIC_API_BASE_URL)
  if (publicBase) return publicBase
  if (runtime === "browser" && origin && !isLocalNextDevOrigin(origin)) {
    return cleanBaseUrl(origin)
  }
  return LOCAL_API_BASE
}

export function resolvePublicApiBaseFromHeaders(
  env: RuntimeUrlEnv = process.env,
  requestHeaders: Pick<Headers, "get">,
) {
  const publicBase = cleanBaseUrl(env.NEXT_PUBLIC_API_BASE_URL)
  if (publicBase) return publicBase

  const host = firstHeaderValue(requestHeaders.get("x-forwarded-host")) || firstHeaderValue(requestHeaders.get("host"))
  if (!host) return LOCAL_API_BASE
  const proto = firstHeaderValue(requestHeaders.get("x-forwarded-proto")) || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https")
  const origin = `${proto}://${host}`
  return isLocalNextDevOrigin(origin) ? LOCAL_API_BASE : cleanBaseUrl(origin)
}

export function resolveWebSocketBase(
  env: RuntimeUrlEnv = process.env,
  runtime: RuntimeKind = currentRuntime(),
  origin = currentOrigin(),
) {
  const explicitBase = cleanBaseUrl(env.NEXT_PUBLIC_WS_BASE_URL)
  if (explicitBase) return explicitBase
  if (runtime === "browser" && origin) {
    const url = new URL(origin)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    return cleanBaseUrl(url.toString())
  }
  return LOCAL_WS_BASE
}

export function resolveChatWebSocketUrl(
  env: RuntimeUrlEnv = process.env,
  runtime: RuntimeKind = currentRuntime(),
  origin = currentOrigin(),
) {
  return joinUrlPath(resolveWebSocketBase(env, runtime, origin), "/api/chat/ws")
}
