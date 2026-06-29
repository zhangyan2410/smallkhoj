import assert from "node:assert/strict"
import test from "node:test"

import { deriveDaemonInstallCommand } from "../lib/daemon-install"

test("deriveDaemonInstallCommand builds install command from connect server URL", () => {
  assert.equal(
    deriveDaemonInstallCommand("smallkhoj-daemon connect --token sk_connect_test --server https://smallkhoj.example.com"),
    "curl -fsSL https://smallkhoj.example.com/downloads/smallkhoj-daemon/install.sh | SMALLKHOJ_DAEMON_DOWNLOAD_BASE_URL=https://smallkhoj.example.com/downloads/smallkhoj-daemon bash",
  )
})

test("deriveDaemonInstallCommand returns null when command has no server URL", () => {
  assert.equal(deriveDaemonInstallCommand("smallkhoj-daemon --version"), null)
})
