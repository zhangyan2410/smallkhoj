export type ComposerTrigger = "@" | "#"

export type ActiveComposerToken = {
  trigger: ComposerTrigger
  query: string
  start: number
  end: number
}

export function activeComposerToken(value: string, caret: number): ActiveComposerToken | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length))
  const beforeCaret = value.slice(0, safeCaret)
  let start = beforeCaret.length
  while (start > 0 && !/\s/u.test(beforeCaret[start - 1])) start -= 1
  const token = beforeCaret.slice(start)
  const trigger = token[0]
  if (trigger !== "@" && trigger !== "#") return null
  if (token.slice(1).includes("@") || token.slice(1).includes("#")) return null
  return {
    trigger,
    query: token.slice(1),
    start,
    end: safeCaret,
  }
}

export function replaceComposerToken(
  value: string,
  token: ActiveComposerToken,
  replacement: string,
): { value: string; caret: number } {
  const suffix = value.slice(token.end)
  const separator = suffix.startsWith(" ") ? "" : " "
  const nextValue = `${value.slice(0, token.start)}${replacement}${separator}${suffix}`
  return {
    value: nextValue,
    caret: token.start + replacement.length + separator.length,
  }
}

export function suggestionSearchKey(value: string): string {
  return value.normalize("NFKC").toLowerCase()
}
