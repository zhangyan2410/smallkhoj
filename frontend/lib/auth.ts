import { betterAuth, type BetterAuthOptions } from "better-auth"
import { getMigrations } from "better-auth/db/migration"
import { nextCookies } from "better-auth/next-js"
import { Pool } from "pg"

const localBetterAuthSecret = "sk_better_auth_local_dev_secret_min_32_chars"
const localDatabaseUrl = "postgresql://smallkhoj:smallkhoj@localhost:5432/smallkhoj"
const defaultBetterAuthDatabasePoolSize = 10

export const betterAuthDatabaseUrl = process.env.BETTER_AUTH_DATABASE_URL || localDatabaseUrl

export function parseBetterAuthDatabasePoolSize(raw: string | undefined) {
  const normalized = raw?.trim()
  if (!normalized) return defaultBetterAuthDatabasePoolSize

  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error("BETTER_AUTH_DATABASE_POOL_SIZE must be a positive integer")
  }
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("BETTER_AUTH_DATABASE_POOL_SIZE must be a safe positive integer")
  }
  return parsed
}

export const betterAuthDatabasePoolSize = parseBetterAuthDatabasePoolSize(
  process.env.BETTER_AUTH_DATABASE_POOL_SIZE,
)

type BetterAuthPoolGlobal = typeof globalThis & {
  __smallkhojBetterAuthPostgresPool?: Pool
}

const betterAuthPoolGlobal = globalThis as BetterAuthPoolGlobal

export const betterAuthPool =
  betterAuthPoolGlobal.__smallkhojBetterAuthPostgresPool ??
  new Pool({
    connectionString: betterAuthDatabaseUrl,
    max: betterAuthDatabasePoolSize,
  })

betterAuthPoolGlobal.__smallkhojBetterAuthPostgresPool ??= betterAuthPool

function betterAuthSecret() {
  const secret = process.env.BETTER_AUTH_SECRET || (process.env.NODE_ENV === "production" ? "" : localBetterAuthSecret)
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required in production")
  return secret
}

export const authOptions = {
  database: betterAuthPool,
  secret: betterAuthSecret(),
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
  },
  plugins: [nextCookies()],
} satisfies BetterAuthOptions

export const auth = betterAuth(authOptions)

let migrationPromise: Promise<void> | null = null

export async function ensureBetterAuthSchema() {
  migrationPromise ??= getMigrations(authOptions).then(({ runMigrations }) => runMigrations())
  await migrationPromise
}
