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

test("connect computer form is hidden once a computer identity exists", () => {
  assert.equal(shouldShowConnectComputerForm({ computerCount: 0, hasPendingCredential: false }), true)
  assert.equal(shouldShowConnectComputerForm({ computerCount: 1, hasPendingCredential: false }), false)
})

test("connect computer form stays visible while showing a pending command", () => {
  assert.equal(shouldShowConnectComputerForm({ computerCount: 1, hasPendingCredential: true }), true)
})
