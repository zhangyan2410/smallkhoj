"use client"

import { useState } from "react"

export function ProviderSelect({
  options,
  unavailableOptions,
}: {
  options: Array<{ value: string; label: string }>
  unavailableOptions: Array<{ value: string; label: string }>
}) {
  const [provider, setProvider] = useState("")
  return (
    <>
      <select
        id="agent-provider"
        name="runtimeProvider"
        className="h-9 min-w-36 rounded-md border bg-background px-3 text-sm"
        onChange={(e) => {
          const opt = [...options, ...unavailableOptions].find((o) => o.value === e.target.value)
          setProvider(opt?.label.split(" / ")[0] ?? "")
        }}
      >
        <option value="">Default</option>
        {options.map((provider) => (
          <option key={provider.value} value={provider.value}>
            {provider.label}
          </option>
        ))}
        {unavailableOptions.length > 0 && (
          <option value="" disabled>
            Unavailable providers
          </option>
        )}
        {unavailableOptions.map((provider) => (
          <option key={provider.value} value={provider.value} disabled>
            {provider.label}
          </option>
        ))}
      </select>
      <input type="hidden" name="provider" value={provider} />
    </>
  )
}
