export function buildComputerReconnectUrl(computerId: string) {
  const encodedComputerId = encodeURIComponent(computerId)
  return `/computers?computer=${encodedComputerId}&reconnect=${encodedComputerId}`
}
