import { query, queryOne } from '../../utils/db'
import { resolveStoreId } from '../../utils/auth'
import { parsePage } from '../../utils/pagination'
import { prefixLike } from '../../utils/like'

const MEMBER_COLS = 'id, store_id, name, phone, birthday, level, balance, points, created_at, updated_at'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const storeId = resolveStoreId(event, (q.store_id as any) ?? null)
  if (!storeId) return { items: [], total: 0 }

  const search = String(q.search || '').trim()
  const { page, pageSize, offset } = parsePage(q)

  // 前缀搜索拆 UNION 分支：每分支 store_id 等值 + 单列 LIKE 范围，走 NOCASE 复合索引
  let fromSql: string
  let params: any[]
  if (search) {
    const kw = prefixLike(search)
    const branch = (col: string) =>
      `SELECT ${MEMBER_COLS} FROM members WHERE store_id = ? AND ${col} LIKE ? ESCAPE '\\'`
    fromSql = `(${branch('name')} UNION ${branch('phone')})`
    params = [storeId, kw, storeId, kw]
  } else {
    fromSql = `(SELECT ${MEMBER_COLS} FROM members WHERE store_id = ?)`
    params = [storeId]
  }

  // 仅首页 COUNT（后续页返回 -1，前端沿用已知 total），消除每页双扫描
  const total = page === 1
    ? Number((await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${fromSql}`, params))?.c || 0)
    : -1

  const items = await query<any>(
    `SELECT * FROM ${fromSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  return { items, total, page, pageSize }
})
