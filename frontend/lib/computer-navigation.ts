export function buildComputerReconnectUrl(computerId: string) {
  const encodedComputerId = encodeURIComponent(computerId)
  return `/computers?computer=${encodedComputerId}&reconnect=${encodedComputerId}`
}

/**
 * 空状态（0 台电脑）或有 pending 命令时，steps dialog 初始打开（代替旧的页面
 * 内嵌卡片）。已有多台电脑时，连接入口在侧边栏的 Add 按钮，由用户显式打开 ——
 * 一个 server 本来就支持挂多台电脑。
 */
export function shouldShowConnectComputerForm({
  computerCount,
  hasPendingCredential,
}: {
  computerCount: number
  hasPendingCredential: boolean
}) {
  return hasPendingCredential || computerCount === 0
}
