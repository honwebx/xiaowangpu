import { query, queryOne } from '../../utils/db'
import { requireManagerUp } from '../../utils/auth'
import { parsePage } from '../../utils/pagination'

export default defineEventHandler(async (event) => {
  const auth = requireManagerUp(event)
  const q = getQuery(event)
  const { page, pageSize, offset } = parsePage(q)

  let where = '1=1'
  const params: any[] = []

  if (auth.role === 'admin') {
    const storeId = q.store_id ? Number(q.store_id) : auth.storeId
    if (storeId) {
      where = '(store_id = ? OR store_id IS NULL)'
      params.push(storeId)
    }
  } else if (auth.storeId) {
    where = 'store_id = ? AND (role = ? OR id = ?)'
    params.push(auth.storeId, 'clerk', auth.userId)
  } else {
    return { items: [], total: 0 }
  }

  // 仅首页 COUNT（后续页返回 -1，前端沿用已知 total），消除每页双扫描
  const total = page === 1
    ? Number((await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM users WHERE ${where}`, params))?.c || 0)
    : -1

  const items = await query<any>(
    `SELECT id, store_id, name, phone, role, status, created_at FROM users WHERE ${where} ORDER BY id LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )

  return { items, total, page, pageSize }
})