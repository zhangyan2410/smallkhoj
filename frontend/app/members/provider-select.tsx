"use client"

import { useMemo, useState } from "react"

export function ProviderSelect({
  options,
  unavailableOptions,
}: {
  options: Array<{ value: string; label: string }>
  unavailableOptions: Array<{ value: string; label: string }>
}) {
  const [runtimeProvider, setRuntimeProvider] = useState("")
  const allOptions = useMemo(() => [...options, ...unavailableOptions], [options, unavailableOptions])
  const selectedOption = allOptions.find((option) => option.value === runtimeProvider)
  const selectedIsUnavailable = unavailableOptions.some((option) => option.value === runtimeProvider)
  const selectedValue = selectedOption && !selectedIsUnavailable ? runtimeProvider : ""
  const provider = selectedValue ? selectedOption?.label.split(" / ")[0] ?? "" : ""

  return (
    <>
      <select
        id="agent-provider"
        name="runtimeProvider"
        value={selectedValue}
        className="h-9 min-w-36 rounded-md border bg-background px-3 text-sm"
        onChange={(e) => {
          setRuntimeProvider(e.target.value)
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
