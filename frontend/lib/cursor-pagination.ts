export type CursorPage<T> = {
  items: T[]
  nextCursor?: string | null
}

export type TaskCursorPage<T> = {
  tasks: T[]
  nextCursor?: string | null
}

export type CursorPaginationOptions = {
  maxPages?: number
}

const DEFAULT_MAX_PAGES = 100

export async function fetchAllCursorPages<T>(
  fetchPage: (cursor: string | null) => Promise<CursorPage<T>>,
  options: CursorPaginationOptions = {},
): Promise<T[]> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error("Cursor pagination maxPages must be a positive integer")
  }

  const items: T[] = []
  const seenCursors = new Set<string>()
  let cursor: string | null = null

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const page = await fetchPage(cursor)
    items.push(...page.items)

    const nextCursor = page.nextCursor ?? null
    if (nextCursor === null) return items
    if (seenCursors.has(nextCursor)) {
      throw new Error("Cursor pagination repeated cursor")
    }
    seenCursors.add(nextCursor)
    cursor = nextCursor
  }

  throw new Error(`Cursor pagination exceeded ${maxPages} pages`)
}

function taskPagePath(cursor: string | null): string {
  const cursorQuery = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`
  return `/api/v1/tasks?limit=200${cursorQuery}`
}

export function fetchAllTaskPages<T>(
  fetchPage: (path: string) => Promise<TaskCursorPage<T>>,
  options?: CursorPaginationOptions,
): Promise<T[]> {
  return fetchAllCursorPages(
    async (cursor) => {
      const page = await fetchPage(taskPagePath(cursor))
      return { items: page.tasks, nextCursor: page.nextCursor }
    },
    options,
  )
}
