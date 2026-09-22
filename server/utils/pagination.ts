export interface PageQuery {
  page?: number | string
  pageSize?: number | string
}

export interface ParsedPage {
  page: number
  pageSize: number
  offset: number
}

export function parsePage(q: PageQuery, opts: { defaultSize?: number; maxSize?: number } = {}): ParsedPage {
  const defaultSize = opts.defaultSize ?? 20
  const maxSize = opts.maxSize ?? 100
  const page = Math.max(1, Number(q.page) || 1)
  const pageSize = Math.min(Math.max(1, Number(q.pageSize) || defaultSize), maxSize)
  return { page, pageSize, offset: (page - 1) * pageSize }
}
