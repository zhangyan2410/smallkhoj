import { auth, ensureBetterAuthSchema } from "@/lib/auth"

export const dynamic = "force-dynamic"

async function handleAuthRequest(request: Request) {
  await ensureBetterAuthSchema()
  return auth.handler(request)
}

export { handleAuthRequest as GET, handleAuthRequest as POST }
