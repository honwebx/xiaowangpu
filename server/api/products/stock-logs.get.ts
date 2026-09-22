import { query, queryOne } from '../../utils/db'
import { getAuth, resolveStoreId } from '../../utils/auth'
import { parsePage } from '../../utils/pagination'
import { beijingDateRange } from '../../utils/dateRange'
import { prefixLike } from '../../utils/like'

const LOG_COLS = `l.id, l.product_id, l.type, l.quantity_change, l.stock_after,
    l.notes, l.supplier, l.related_order_id, l.created_at, l.operator_id,
    p.name AS product_name, p.short_code AS product_short_code, p.barcode AS product_barcode`
const LOG_JOINS = 'FROM product_stock_logs l LEFT JOIN products p ON p.id = l.product_id'

function beijingDaysAgo(n: number): string {
  const t = new Date(Date.now() - n * 86400_000).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
  return t.slice(0, 10)
}

export default defineEventHandler(async (event) => {
  const auth = getAuth(event)
  const q = getQuery(event)
  const storeId = resolveStoreId(event, (q.store_id as any) ?? null)
  if (!storeId) return { items: [], total: 0 }

  const { page, pageSize, offset } = parsePage(q)
  const search = String(q.search || '').trim()
  const type = String(q.type || '').trim()
  let dateFrom = String(q.date_from || '').trim()
  const dateTo = String(q.date_to || '').trim()

  // 无任何筛选时默认近 30 天，避免全量历史 COUNT 随数据增长而恶化
  if (!search && !type && !dateFrom && !dateTo) {
    dateFrom = beijingDaysAgo(30)
  }

  const baseWhere: string[] = ['l.store_id = ?']
  const baseParams: any[] = [storeId]
  if (type) {
    baseWhere.push('l.type = ?')
    baseParams.push(type)
  }
  if (dateFrom) {
    const [start] = beijingDateRange(dateFrom)
    baseWhere.push('l.created_at >= ?')
    baseParams.push(start)
  }
  if (dateTo) {
    const [, end] = beijingDateRange(dateTo)
    baseWhere.push('l.created_at < ?')
    baseParams.push(end)
  }
  const baseClause = baseWhere.join(' AND ')

  // 商品名前缀搜索：OR 单次扫描（LIKE 列在 JOIN 表上，UNION 会 triple-scan；products 侧 NOCASE 索引已备，优化器自选）
  let searchClause = ''
  let searchParams: any[] = []
  if (search) {
    const kw = prefixLike(search)
    searchClause = ` AND (p.name LIKE ? ESCAPE '\\' OR p.short_code LIKE ? ESCAPE '\\' OR p.barcode LIKE ? ESCAPE '\\')`
    searchParams = [kw, kw, kw]
  }
  const fromSql = `(SELECT ${LOG_COLS} ${LOG_JOINS} WHERE ${baseClause}${searchClause})`
  const params = [...baseParams, ...searchParams]
  // 无搜索时 COUNT 无需 JOIN products（LEFT JOIN 不改变计数）
  const countSql = search
    ? `SELECT COUNT(*) AS c FROM ${fromSql}`
    : `SELECT COUNT(*) AS c FROM product_stock_logs l WHERE ${baseClause}`
  const countParams = search ? params : [...baseParams]

  // 仅首页 COUNT（后续页返回 -1，前端沿用已知 total），消除每页双扫描
  const total = page === 1
    ? Number((await queryOne<{ c: number }>(countSql, countParams))?.c || 0)
    : -1

  const logs = await query<any>(
    `SELECT * FROM ${fromSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const userIds = [...new Set(logs.map((l: any) => l.operator_id).filter(Boolean))].slice(0, 50)
  const userMap = new Map<number, string>()
  if (userIds.length > 0) {
    const users = await query<{ id: number; name: string }>(
      `SELECT id, name FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`,
      userIds
    )
    for (const u of users) userMap.set(u.id, u.name)
  }

  const items = logs.map((l: any) => ({
    ...l,
    cost_price: auth.role === 'clerk' ? null : l.cost_price,
    operator_name: l.operator_id ? (userMap.get(l.operator_id) || '-') : '-',
  }))

  return { items, total, page, pageSize }
})
