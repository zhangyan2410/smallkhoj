import { redirect } from "next/navigation"

import { API_BASE, type Member } from "@/lib/control-plane"
import { requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"

type DmInfo = {
  id: string
  name: string
  displayName?: string | null
  peerId?: string | null
  peer?: Member | null
}

function channelPathSegment(name: string) {
  return encodeURIComponent(name.replace(/^#/, ""))
}

function normalizeMemberRef(value: string) {
  return value.trim().replace(/^@/, "").toLowerCase()
}

function matchesDm(dm: DmInfo, memberRef: string) {
  const normalized = normalizeMemberRef(memberRef)
  const peer = dm.peer
  const candidates = [
    dm.id,
    dm.name,
    dm.displayName,
    dm.peerId,
    peer?.id,
    peer?.name,
    peer?.handle,
    peer?.displayName,
    peer?.profile?.displayName,
  ]

  return candidates.some((candidate) => candidate && normalizeMemberRef(candidate) === normalized)
}

export default async function LegacyDmPage({ params }: { params: Promise<{ member: string }> }) {
  await requireCurrentAccount()
  const { member } = await params
  const decodedMember = decodeURIComponent(member)
  const headers = await serverApiHeaders()
  const response = await fetch(`${API_BASE}/api/v1/dms`, { headers, cache: "no-store" })
  const data = response.ok ? await response.json() as { dms?: DmInfo[] } : {}
  const target = (data.dms || []).find((dm) => matchesDm(dm, decodedMember))

  redirect(target ? `/chat/${channelPathSegment(target.name)}` : "/chat")
}
