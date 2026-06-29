const DOWNLOAD_PATH = "/downloads/smallkhoj-daemon"

export function deriveDaemonInstallCommand(connectCommand?: string | null) {
  if (!connectCommand) return null
  const match = connectCommand.match(/(?:^|\s)--server\s+((?:"[^"]+")|(?:'[^']+')|\S+)/)
  if (!match) return null
  const rawServer = match[1].replace(/^['"]|['"]$/g, "").replace(/\/$/, "")
  if (!rawServer) return null
  const downloadBaseUrl = `${rawServer}${DOWNLOAD_PATH}`
  return `curl -fsSL ${downloadBaseUrl}/install.sh | SMALLKHOJ_DAEMON_DOWNLOAD_BASE_URL=${downloadBaseUrl} bash`
}
