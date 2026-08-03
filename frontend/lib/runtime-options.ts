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

/**
 * 4 种产品支持的 runtime —— Computers 详情页只展示这 4 条（已装亮、未装灰），
 * ccswitch/manual/opencode-config 检测出的 provider 条目不在 chips 区平铺
 * （它们仅供 Provider 下拉等高级用法使用）。
 */
export const PRIMARY_RUNTIMES = ["claude_code", "codex", "opencode", "pi"] as const

/** 是否是 4 条主 runtime 之一（即不含 provider 附加条目）。
 *  provider 附加条目虽然 type 也是 claude_code/codex/opencode，但带有
 *  runtimeProvider/provider 字段，靠这个把它们排除掉。bundled Pi 带
 *  source:'bundled' 但没有 runtimeProvider/provider，算主 runtime。 */
export function isPrimaryRuntime(runtime: RuntimeInfo): boolean {
  if (typeof runtime === "string") return false
  if (runtime.runtimeProvider || runtime.provider) return false
  return (PRIMARY_RUNTIMES as readonly string[]).includes(publicRuntimeValue(runtime))
}

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
    case "opencode":
    case "open_code":
      return "opencode"
    case "pi":
      return "pi"
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
    case "pi":
      return []
    default:
      return []
  }
}

/**
 * Runtime 下拉选项类型。bundled = 随包自带(如 built-in Pi)，无需用户本机安装，
 * 始终可选；available = 本机 daemon 实际检测到的；否则不可选(灰掉)。
 */
export type RuntimeOption = {
  value: string
  label: string
  available: boolean
  bundled?: boolean
}

/**
 * 已知 runtime 的显示名。未检测到时用作灰掉的占位项。
 * bundled Pi 不进这个表 —— 它恒在 detectedRuntimesForInventory 上报。
 */
const RUNTIME_LABELS: Record<string, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  custom: "Custom",
}

/**
 * 从 computers 的 detectedRuntimes 聚合成 Runtime 下拉选项。
 * - detected 的 runtime -> 可选 (available: true)
 * - bundled Pi (source==='bundled') -> 可选 + bundled 标识
 * - 已知但未 detected 的 (claude_code/codex) -> 灰掉 (available: false)
 * - custom 恒可选(不依赖检测)
 *
 * 和 Provider 下拉(detectedProviderOptions)用同一数据源 detectedRuntimes。
 */
export function runtimeOptionsFromDetected(
  computers: Computer[],
  filters: ProviderOptionFilters = {},
): RuntimeOption[] {
  const detected = new Set<string>()
  for (const computer of computers) {
    if (filters.computerId && computer.id !== filters.computerId) continue
    for (const runtime of computer.detectedRuntimes) {
      if (typeof runtime === "string") {
        detected.add(publicRuntimeValue(runtime))
        continue
      }
      // not_installed 条目只表示「这台机器没装该 CLI」，不能算作可用 runtime。
      if (runtime.status === "not_installed") continue
      const value = publicRuntimeValue(runtime)
      if (!value) continue
      detected.add(value)
    }
  }

  const options: RuntimeOption[] = []
  // 已知 runtime：检测到的可选，没检测到的灰掉
  for (const [value, label] of Object.entries(RUNTIME_LABELS)) {
    options.push({ value, label, available: detected.has(value) })
  }
  // custom 恒可选
  options.push({ value: "custom", label: RUNTIME_LABELS.custom, available: true })
  // bundled Pi：恒可选 + 标识
  options.push({
    value: "pi",
    label: "Built-in Pi",
    available: true,
    bundled: true,
  })
  // 去重(防止 detected 里出现非标准值导致 pi 重复)
  const seen = new Set<string>()
  return options.filter((opt) => {
    if (seen.has(opt.value)) return false
    seen.add(opt.value)
    return true
  })
}
