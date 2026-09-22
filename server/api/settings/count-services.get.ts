import { query, queryOne } from '../../utils/db'
import { resolveStoreId } from '../../utils/auth'
import { parsePage } from '../../utils/pagination'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const storeId = resolveStoreId(event, (q.store_id as any) ?? null)

  if (!storeId) return { items: [], total: 0 }

  const { page, pageSize, offset } = parsePage(q)

  // 仅首页 COUNT（后续页返回 -1，前端沿用已知 total），消除每页双扫描
  const total = page === 1
    ? Number((await queryOne<{ c: number }>(
        'SELECT COUNT(*) AS c FROM count_services WHERE store_id = ?',
        [storeId],
      ))?.c || 0)
    : -1

  const items = await query<any>(
    'SELECT * FROM count_services WHERE store_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
    [storeId, pageSize, offset],
  )

  return { items, total, page, pageSize }
})