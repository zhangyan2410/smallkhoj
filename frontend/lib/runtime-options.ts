import { runtimeLabel, type Computer, type RuntimeInfo } from "@/lib/control-plane"

// 期望出现在已连接 computer 上的 runtime provider 清单。
// 未被探测到时，表单会把它们显示为 disabled 的「不可用」选项。
export const EXPECTED_RUNTIME_PROVIDERS = [
  "Codex",
  "OpenCode",
  "Antigravity",
  "Pi",
]

export type ProviderOption = { value: string; label: string }

export type ProviderOptionFilters = {
  computerId?: string
  runtime?: string
}

/**
 * 从 computers 的 detectedRuntimes 里聚合出可用的 runtime provider 选项。
 * 后端 RuntimeInfo 可能是字符串（旧格式）或对象，这里只取对象形式。
 */
export function detectedProviderOptions(computers: Computer[], filters: ProviderOptionFilters = {}): ProviderOption[] {
  const options = new Map<string, string>()
  for (const computer of computers) {
    if (filters.computerId && computer.id !== filters.computerId) continue
    for (const runtime of computer.detectedRuntimes) {
      if (typeof runtime === "string") continue
      if (filters.runtime && publicRuntimeValue(runtime) !== publicRuntimeValue(filters.runtime)) continue
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
export function unavailableProviderOptions(providerOptions: ProviderOption[], filters: ProviderOptionFilters = {}): ProviderOption[] {
  const available = new Set(providerOptions.map((provider) => provider.value))
  const expected = filters.runtime ? expectedProviderNamesForRuntime(filters.runtime) : EXPECTED_RUNTIME_PROVIDERS
  const suffix = filters.runtime ? "selected computer" : "connected computers"
  return expected
    .filter((provider) => !available.has(provider))
    .map((provider) => ({
      value: provider,
      label: `${provider} (not detected on ${suffix})`,
    }))
}

export function publicRuntimeValue(runtime: RuntimeInfo | string | undefined): string {
  const raw = typeof runtime === "string" ? runtime : runtime?.type
  switch ((raw ?? "").toLowerCase()) {
    case "claude":
    case "claude_code":
      return "claude_code"
    case "codex":
    case "codex_cli":
    case "codex_acp":
    case "codex-acp":
      return "codex"
    case "custom":
      return "custom"
    default:
      return raw ?? ""
  }
}

function expectedProviderNamesForRuntime(runtime: string): string[] {
  switch (publicRuntimeValue(runtime)) {
    case "codex":
      return ["Codex"]
    case "custom":
      return []
    case "claude_code":
      return []
    default:
      return []
  }
}
