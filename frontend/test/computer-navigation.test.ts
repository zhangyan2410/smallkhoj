import assert from "node:assert/strict"
import test from "node:test"

import { buildComputerReconnectUrl, shouldShowConnectComputerForm } from "../lib/computer-navigation"

test("computer reconnect URL keeps the selected computer detail open", () => {
  const computerId = "computer id/with spaces"

  assert.equal(
    buildComputerReconnectUrl(computerId),
    "/computers?computer=computer%20id%2Fwith%20spaces&reconnect=computer%20id%2Fwith%20spaces",
  )
})

test("inline connect computer form only shows for the empty state", () => {
  assert.equal(shouldShowConnectComputerForm({ computerCount: 0, hasPendingCredential: false }), true)
  // 已有电脑时内嵌卡片隐藏；连接入口由侧边栏 Add 按钮 + dialog 承担，
  // 所以这里必须为 false，否则会出现两个入口。
  assert.equal(shouldShowConnectComputerForm({ computerCount: 1, hasPendingCredential: false }), false)
  assert.equal(shouldShowConnectComputerForm({ computerCount: 3, hasPendingCredential: false }), false)
})

test("inline connect computer form stays visible while showing a pending command", () => {
  assert.equal(shouldShowConnectComputerForm({ computerCount: 1, hasPendingCredential: true }), true)
})
