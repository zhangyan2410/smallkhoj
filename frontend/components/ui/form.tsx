/**
 * 轻量表单原语：FieldLabel + Select。
 * 从 app/tasks/page.tsx 抽出共享，供页面内表单和对话框复用。
 * 纯展示组件，无状态，server/client 通用。
 */

export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">
      {children}
    </label>
  )
}

export function Select({
  id,
  name,
  items,
  fallback,
  splitValue = false,
  defaultValue,
  emptyLabel = "",
}: {
  id: string
  name: string
  items: string[]
  fallback?: string
  splitValue?: boolean
  defaultValue?: string
  emptyLabel?: string
}) {
  const options = items.length > 0 ? items : fallback ? [fallback] : []
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue ?? (splitValue ? options[0]?.split("|")[0] : fallback || options[0])}
      className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {!fallback && <option value="">{emptyLabel}</option>}
      {options.map((item) => {
        const [value, label] = splitValue ? item.split("|", 2) : [item, item]
        return (
          <option key={item} value={value}>
            {label}
          </option>
        )
      })}
    </select>
  )
}
