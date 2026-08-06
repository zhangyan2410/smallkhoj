import assert from "node:assert/strict"
import test from "node:test"

import {
  detectInitialPlatform,
  isExpired,
  phaseCommand,
  renderPhaseCommand,
  type PlatformCommandMap,
} from "@/lib/computer-onboarding"

const platforms: PlatformCommandMap = {
  windows: {
    shell: "powershell",
    available: true,
    install: { command: "irm https://example.test/install.ps1 | iex" },
    setup: {
      command: "aura setup --name 'my-computer'",
      commandTemplate: "aura setup --name '{{name}}'",
    },
    connect: { command: null, requiresTicket: true },
  },
  unix: {
    shell: "bash",
    available: true,
    install: { command: "curl -fsSL https://example.test/install.sh | bash" },
    setup: { command: "aura setup --name 'my-computer'" },
    connect: { command: null, requiresTicket: true },
  },
}

test("browser hint only chooses the initial tab", () => {
    assert.equal(detectInitialPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32"), "windows")
    assert.equal(detectInitialPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel"), "unix")
  })

test("phase lookup and name interpolation never invent a ticket", () => {
    assert.equal(phaseCommand(platforms, "windows", "connect")?.command, null)
    assert.equal(renderPhaseCommand(phaseCommand(platforms, "windows", "setup"), "O'Brien", "windows"),
      "aura setup --name 'O''Brien'",
    )
  })

test("expiry is bounded and invalid dates fail closed as not expired", () => {
    assert.equal(isExpired("2026-08-06T00:00:00.000Z", Date.parse("2026-08-06T00:00:01.000Z")), true)
    assert.equal(isExpired("not-a-date", Date.now()), false)
    assert.equal(isExpired(null), false)
  })
