export function buildComputerReconnectUrl(computerId: string) {
  const encodedComputerId = encodeURIComponent(computerId)
  return `/computers?computer=${encodedComputerId}&reconnect=${encodedComputerId}`
}

export function shouldShowConnectComputerForm({
  computerCount,
  hasPendingCredential,
}: {
  computerCount: number
  hasPendingCredential: boolean
}) {
  return hasPendingCredential || computerCount === 0
}
