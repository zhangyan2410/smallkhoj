/**
 * 轻量表单原语：FieldLabel + Select + Textarea。
 * 手作风统一：墨色 2px 硬描边 + 直角 + focus 变中海蓝。
 * 纯展示组件，无状态，server/client 通用。
 */

export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-sm font-medium text-foreground"
    >
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
  className,
}: {
  id: string
  name: string
  items: string[]
  fallback?: string
  splitValue?: boolean
  defaultValue?: string
  emptyLabel?: string
  className?: string
}) {
  const options = items.length > 0 ? items : fallback ? [fallback] : []
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue ?? (splitValue ? options[0]?.split("|")[0] : fallback || options[0])}
      className={
        "h-8 w-full rounded-none border-2 border-[var(--ink)] bg-transparent px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset" +
        (className ? ` ${className}` : "")
      }
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

/**
 * 多行文本框。手作风：墨色 2px 硬描边 + 直角 + focus 变中海蓝。
 * 用法同原生 textarea，自动应用统一风格。
 */
export function Textarea({
  id,
  name,
  defaultValue,
  placeholder,
  className,
  rows = 3,
  ...rest
}: {
  id?: string
  name?: string
  defaultValue?: string
  placeholder?: string
  className?: string
  rows?: number
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      id={id}
      name={name}
      defaultValue={defaultValue}
      placeholder={placeholder}
      rows={rows}
      className={
        "w-full rounded-none border-2 border-[var(--ink)] bg-transparent p-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset" +
        (className ? ` ${className}` : "")
      }
      {...rest}
    />
  )
}
