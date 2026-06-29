import { betterAuth, type BetterAuthOptions } from "better-auth"
import { getMigrations } from "better-auth/db/migration"
import { nextCookies } from "better-auth/next-js"
import { Pool } from "pg"

const localBetterAuthSecret = "sk_better_auth_local_dev_secret_min_32_chars"
const localDatabaseUrl = "postgresql://smallkhoj:smallkhoj@localhost:5432/smallkhoj"

export const betterAuthDatabaseUrl = process.env.BETTER_AUTH_DATABASE_URL || localDatabaseUrl

const betterAuthPool = new Pool({
  connectionString: betterAuthDatabaseUrl,
})

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
