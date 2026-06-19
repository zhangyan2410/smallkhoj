import { runtimeLabel, type Computer } from "@/lib/control-plane"

// 期望出现在已连接 computer 上的 runtime provider 清单。
// 未被探测到时，表单会把它们显示为 disabled 的「不可用」选项。
export const EXPECTED_RUNTIME_PROVIDERS = [
  "Codex CLI",
  "OpenCode",
  "Antigravity",
  "Pi",
]

export type ProviderOption = { value: string; label: string }

/**
 * 从 computers 的 detectedRuntimes 里聚合出可用的 runtime provider 选项。
 * 后端 RuntimeInfo 可能是字符串（旧格式）或对象，这里只取对象形式。
 */
export function detectedProviderOptions(computers: Computer[]): ProviderOption[] {
  const options = new Map<string, string>()
  for (const computer of computers) {
    for (const runtime of computer.detectedRuntimes) {
      if (typeof runtime === "string") continue
      const provider = runtime.runtimeProvider ?? runtime.provider
      if (!provider) continue
      options.set(provider, runtimeLabel(runtime))
    }
  }
  return Array.from(options, ([value, label]) => ({ value, label }))
}

/**
 * 预期存在但当前未探测到的 provider，渲染为 disabled 提示项。
 */
export function unavailableProviderOptions(providerOptions: ProviderOption[]): ProviderOption[] {
  const available = new Set(providerOptions.map((provider) => provider.value))
  return EXPECTED_RUNTIME_PROVIDERS
    .filter((provider) => !available.has(provider))
    .map((provider) => ({
      value: provider,
      label: `${provider} (not detected on connected computers)`,
    }))
}
