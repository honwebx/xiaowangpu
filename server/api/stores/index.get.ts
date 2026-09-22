import { query, queryOne } from '../../utils/db'
import { getAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const auth = getAuth(event)
  const q = getQuery(event)
  const page = Number(q.page) || 1
  const pageSize = Math.min(Number(q.pageSize) || 20, 100)
  const offset = (page - 1) * pageSize

  if (auth.role !== 'admin') {
    if (!auth.storeId) return { items: [], total: 0 }
    const totalRow = await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM stores WHERE id = ?', [auth.storeId])
    const items = await query<any>(
      'SELECT id, name, address, phone, created_at FROM stores WHERE id = ? ORDER BY id',
      [auth.storeId],
    )
    return { items, total: totalRow?.c || 0, page, pageSize }
  }

  // 仅首页 COUNT（后续页返回 -1，前端沿用已知 total），消除每页双扫描
  const total = page === 1
    ? Number((await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM stores'))?.c || 0)
    : -1
  const items = await query<any>(
    'SELECT id, name, address, phone, created_at FROM stores ORDER BY id LIMIT ? OFFSET ?',
    [pageSize, offset],
  )
  return { items, total, page, pageSize }
})
