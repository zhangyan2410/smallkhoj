import assert from "node:assert/strict"
import test from "node:test"

import { buildComputerReconnectUrl } from "../lib/computer-navigation"

test("computer reconnect URL keeps the selected computer detail open", () => {
  const computerId = "computer id/with spaces"

  assert.equal(
    buildComputerReconnectUrl(computerId),
    "/computers?computer=computer%20id%2Fwith%20spaces&reconnect=computer%20id%2Fwith%20spaces",
  )
})
