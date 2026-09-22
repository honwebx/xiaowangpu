import { query, queryOne } from '../../utils/db'
import { getAuth, resolveStoreId } from '../../utils/auth'
import { parsePage } from '../../utils/pagination'
import { containsLike, prefixLike } from '../../utils/like'

export default defineEventHandler(async (event) => {
  const auth = getAuth(event)
  const q = getQuery(event)
  const storeId = resolveStoreId(event, (q.store_id as any) ?? null)
  if (!storeId) return { items: [], total: 0 }

  const search = String(q.search || '').trim()
  const status = String(q.status || '').trim()
  const stockAlertOnly = String(q.stock_alert_only || '') === '1' || q.stock_alert_only === true
  const scope = String(q.scope || '').trim()
  const fuzzy = String(q.fuzzy || '') === '1' || q.fuzzy === true
  const { page, pageSize, offset } = parsePage(q)

  const costCol = auth.role === 'clerk' ? 'NULL AS cost_price' : 'cost_price'
  const itemCols = `id, store_id, name, short_code, barcode, primary_unit, selling_price,
      secondary_unit, conversion_rate, secondary_price, ${costCol},
      discountable, stock_quantity, stock_alert, status, created_at, updated_at`
  const posCols = `id, store_id, name, short_code, barcode, primary_unit, selling_price,
      secondary_unit, conversion_rate, secondary_price, ${costCol},
      discountable, stock_quantity, stock_alert, status`

  if (scope === 'pos') {
    if (search) {
      if (/^[\dA-Za-z-]+$/.test(search)) {
        const exact = await query<any>(
          `SELECT ${posCols} FROM products WHERE store_id = ? AND barcode = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
          [storeId, search]
        )
        if (exact.length) return { items: exact, total: 1, page: 1, pageSize }
      }
    } else {
      const items = await query<any>(
        `SELECT ${posCols} FROM products WHERE store_id = ? AND status = 'active' ORDER BY id DESC LIMIT ?`,
        [storeId, pageSize]
      )
      return { items, total: -1, page: 1, pageSize }
    }
    if (/^\d+$/.test(search)) {
      const items = await query<any>(
        `SELECT ${posCols} FROM products WHERE store_id = ? AND barcode LIKE ? ESCAPE '\\' AND status = 'active' ORDER BY id DESC LIMIT ?`,
        [storeId, prefixLike(search), pageSize]
      )
      return { items, total: -1, page: 1, pageSize }
    }
    const kw = prefixLike(search)
    const branch = (col: string) =>
      `SELECT ${posCols} FROM products WHERE store_id = ? AND ${col} LIKE ? ESCAPE '\\' AND status = 'active'`
    const items = await query<any>(
      `SELECT * FROM (${branch('name')} UNION ${branch('barcode')} UNION ${branch('short_code')}) ORDER BY id DESC LIMIT ?`,
      [storeId, kw, storeId, kw, storeId, kw, pageSize]
    )
    return { items, total: -1, page: 1, pageSize }
  }

  const baseFilters: string[] = []
  const baseParams: any[] = []
  if (stockAlertOnly) {
    baseFilters.push(`status = 'active'`, 'stock_quantity <= COALESCE(stock_alert, 10)')
  } else if (status) {
    baseFilters.push('status = ?')
    baseParams.push(status)
  }
  const extra = baseFilters.length ? ` AND ${baseFilters.join(' AND ')}` : ''

  // 前缀搜索拆 UNION 分支：每分支 store_id 等值 + 单列 LIKE 范围，走 NOCASE 复合索引；
  // 模糊搜索（管理页 fuzzy=1）走不了范围索引，合并为单查询 OR 本店扫描
  let fromSql: string
  let params: any[]
  if (search && fuzzy) {
    const kw = containsLike(search)
    fromSql = `(SELECT ${itemCols} FROM products WHERE store_id = ? AND (name LIKE ? ESCAPE '\\' OR barcode LIKE ? ESCAPE '\\' OR short_code LIKE ? ESCAPE '\\')${extra})`
    params = [storeId, kw, kw, kw, ...baseParams]
  } else if (search) {
    const kw = prefixLike(search)
    const branch = (col: string) =>
      `SELECT ${itemCols} FROM products WHERE store_id = ? AND ${col} LIKE ? ESCAPE '\\'${extra}`
    fromSql = `(${branch('name')} UNION ${branch('barcode')} UNION ${branch('short_code')})`
    params = [storeId, kw, ...baseParams, storeId, kw, ...baseParams, storeId, kw, ...baseParams]
  } else {
    fromSql = `(SELECT ${itemCols} FROM products WHERE store_id = ?${extra})`
    params = [storeId, ...baseParams]
  }

  // total 跟列表条件；alert_count 为全局在售预警数（不受 search/分页/预警筛选影响），仅首页查一次
  const [counts, alertRow] = await Promise.all([
    page === 1
      ? queryOne<{ total: number }>(`SELECT COUNT(*) AS total FROM ${fromSql}`, params)
      : Promise.resolve(null),
    page === 1 && !stockAlertOnly
      ? queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM products WHERE store_id = ? AND status = 'active' AND stock_quantity <= COALESCE(stock_alert, 10)`,
        [storeId]
      )
      : Promise.resolve(null),
  ])
  const total = page === 1 ? Number(counts?.total || 0) : -1
  const alertCount = Number(alertRow?.c || 0)

  const items = await query<any>(
    `SELECT * FROM ${fromSql} ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END, id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  return { items, total, page, pageSize, alert_count: stockAlertOnly || page > 1 ? undefined : alertCount }
})
