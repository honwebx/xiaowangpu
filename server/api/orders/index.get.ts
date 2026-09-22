import { query, queryOne } from '../../utils/db'
import { resolveStoreId } from '../../utils/auth'
import { parsePage } from '../../utils/pagination'
import { beijingDateRange } from '../../utils/dateRange'
import { prefixLike } from '../../utils/like'

const SELECT_COLS = 'o.*, m.name AS member_name, u.name AS operator_name'
const JOINS = 'FROM orders o LEFT JOIN members m ON m.id = o.member_id LEFT JOIN users u ON u.id = o.operator_id'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const storeId = resolveStoreId(event, (q.store_id as any) ?? null)

  const baseWhere: string[] = []
  const baseParams: any[] = []
  if (storeId) { baseWhere.push('o.store_id = ?'); baseParams.push(storeId) }
  if (q.type) { baseWhere.push('o.type = ?'); baseParams.push(q.type) }
  if (q.member_id) { baseWhere.push('o.member_id = ?'); baseParams.push(Number(q.member_id)) }
  if (q.date_from) {
    const [start] = beijingDateRange(String(q.date_from))
    baseWhere.push('o.created_at >= ?'); baseParams.push(start)
  }
  if (q.date_to) {
    const [, end] = beijingDateRange(String(q.date_to))
    baseWhere.push('o.created_at < ?'); baseParams.push(end)
  }
  const baseClause = baseWhere.length ? baseWhere.join(' AND ') : '1=1'

  // 会员名前缀搜索：OR 单次扫描（LIKE 列在 JOIN 表上，UNION 会 double-scan；members 侧 NOCASE 索引已备，优化器自选）
  let searchClause = ''
  let searchParams: any[] = []
  if (q.search) {
    const kw = prefixLike(String(q.search))
    searchClause = ` AND (m.name LIKE ? ESCAPE '\\' OR m.phone LIKE ? ESCAPE '\\')`
    searchParams = [kw, kw]
  }
  const fromSql = `(SELECT ${SELECT_COLS} ${JOINS} WHERE ${baseClause}${searchClause})`
  const params = [...baseParams, ...searchParams]

  if (q.limit && !q.page) {
    const limit = Math.min(Number(q.limit) || 100, 500)
    return await query(
      `SELECT * FROM ${fromSql} ORDER BY id DESC LIMIT ?`,
      [...params, limit],
    )
  }

  const { page, pageSize, offset } = parsePage(q)

  // 仅首页 COUNT（后续页返回 -1，前端沿用已知 total），消除每页双扫描
  const total = page === 1
    ? Number((await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${fromSql}`, params))?.c || 0)
    : -1

  const items = await query(
    `SELECT * FROM ${fromSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )

  return { items, total, page, pageSize }
})
