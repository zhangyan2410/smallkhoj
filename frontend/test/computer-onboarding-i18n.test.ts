import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import en from "../messages/en.json"
import zh from "../messages/zh-CN.json"

const onboardingKeys = [
  "dialogDesc",
  "reconnectTitle",
  "reconnectDesc",
  "platformWindows",
  "platformUnix",
  "phaseInstall",
  "phaseSetup",
  "phaseConnect",
  "shellPowerShell",
  "shellTerminal",
  "installGuideWindows",
  "installGuideUnix",
  "installExpect",
  "setupGuide",
  "setupExpect",
  "connectCta",
  "generating",
  "connectGuide",
  "connectExpect",
  "copy",
  "copied",
  "regenerate",
  "expiredNotice",
  "statusIdle",
  "pendingHint",
  "timeoutTitle",
  "timeoutHint",
  "conflictActive",
  "windowsUnavailable",
] as const

test("onboarding copy is complete in both locale resources", () => {
  for (const key of onboardingKeys) {
    assert.equal(typeof en.computers.onboarding[key], "string", `en.computers.onboarding.${key}`)
    assert.ok(en.computers.onboarding[key].trim(), `en.computers.onboarding.${key}`)
    assert.equal(typeof zh.computers.onboarding[key], "string", `zh.computers.onboarding.${key}`)
    assert.ok(zh.computers.onboarding[key].trim(), `zh.computers.onboarding.${key}`)
  }
})

test("Chinese onboarding does not duplicate English labels in prose", () => {
  const chinese = zh.computers.onboarding

  assert.equal(chinese.phaseInstall, "安装")
  assert.equal(chinese.phaseSetup, "初始化")
  assert.equal(chinese.phaseConnect, "连接")
  assert.equal(chinese.shellTerminal, "终端")
  assert.equal(chinese.installGuideUnix, "打开「终端」，粘贴命令后回车。")
  assert.equal(chinese.setupExpect, "输出机器 ID 和配置路径即完成；重复执行安全。")
  assert.doesNotMatch(chinese.phaseInstall, /\([^)]*\)|（[^）]*）/)
  assert.doesNotMatch(chinese.phaseSetup, /\([^)]*\)|（[^）]*）/)
  assert.doesNotMatch(chinese.phaseConnect, /\([^)]*\)|（[^）]*）/)
  assert.doesNotMatch(chinese.installGuideUnix, /Terminal/i)
})

test("computer name field keeps the readable onboarding geometry contract", () => {
  const component = readFileSync(new URL("../app/(app)/computers/connect-computer-form.tsx", import.meta.url), "utf8")
  const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")

  assert.match(component, /sk-onboarding-name-input h-11 w-full max-w-none text-base/)
  assert.match(component, /overflow-x-hidden overflow-y-auto/)
  assert.match(styles, /\.sk-computer-onboarding \.sk-onboarding-name-input[\s\S]*font-size: 1rem/)
})
