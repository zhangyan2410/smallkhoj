"use client"

import { useMemo, useState } from "react"

import { Select, type SelectOption } from "@/components/ui/form"

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
  const items: SelectOption[] = [
    ...options,
    ...(unavailableOptions.length > 0 ? [{ value: "__unavailable", label: "Unavailable providers", disabled: true }] : []),
    ...unavailableOptions.map((option) => ({ ...option, disabled: true })),
  ]

  return (
    <>
      <Select
        id="agent-provider"
        name="runtimeProvider"
        value={selectedValue}
        items={items}
        emptyLabel="Default"
        className="h-9 min-w-36 px-3"
        onChange={(e) => {
          setRuntimeProvider(e.target.value)
        }}
      />
      <input type="hidden" name="provider" value={provider} />
    </>
  )
}
