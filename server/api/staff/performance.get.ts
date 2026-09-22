import { query, round2 } from '../../utils/db'
import { requireManagerUp, resolveStoreId, ensureStoreAccess } from '../../utils/auth'

function isDateStr(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function beijingToday(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 10)
}

function nextDayStr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + 1))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} 00:00:00`
}

export default defineEventHandler(async (event) => {
  const auth = requireManagerUp(event)
  const q = getQuery(event)
  const storeId = resolveStoreId(event, (q.store_id as any) ?? null)
  if (!storeId) throw createError({ statusCode: 400, message: '请选择店铺' })
  ensureStoreAccess(event, storeId)

  const today = beijingToday()
  const from = isDateStr(q.date_from) ? (q.date_from as string) : `${today.slice(0, 7)}-01`
  const to = isDateStr(q.date_to) ? (q.date_to as string) : today
  const start = `${from} 00:00:00`
  const end = nextDayStr(to)

  const [orderRows, rechargeRows, countRows, manualRows, users, nullRow] = await Promise.all([
    query<any>(
      `SELECT operator_id,
              COALESCE(SUM(CASE WHEN type='sale' THEN payable_amount ELSE 0 END),0) AS sales,
              COALESCE(SUM(CASE WHEN type='return' THEN payable_amount ELSE 0 END),0) AS returns,
              COALESCE(SUM(CASE WHEN type='sale' THEN 1 ELSE 0 END),0) AS cnt
         FROM orders
        WHERE store_id = ? AND created_at >= ? AND created_at < ? AND operator_id IS NOT NULL
        GROUP BY operator_id`,
      [storeId, start, end]
    ),
    query<any>(
      `SELECT operator_id, COALESCE(SUM(amount),0) AS v
         FROM balance_logs
        WHERE store_id = ? AND type = 'recharge' AND created_at >= ? AND created_at < ? AND operator_id IS NOT NULL
        GROUP BY operator_id`,
      [storeId, start, end]
    ),
    query<any>(
      `SELECT operator_id, COALESCE(SUM(unit_amount),0) AS v
         FROM count_usage_logs
        WHERE store_id = ? AND created_at >= ? AND created_at < ? AND operator_id IS NOT NULL
        GROUP BY operator_id`,
      [storeId, start, end]
    ),
    query<any>(
      `SELECT operator_id, COALESCE(SUM(amount),0) AS v
         FROM balance_logs
        WHERE store_id = ? AND type = 'consume' AND related_order_id IS NULL AND created_at >= ? AND created_at < ? AND operator_id IS NOT NULL
        GROUP BY operator_id`,
      [storeId, start, end]
    ),
    (async () => {
      if (auth.role === 'admin') {
        return await query<any>(
          'SELECT id, name, role FROM users WHERE store_id = ? OR store_id IS NULL ORDER BY id',
          [storeId]
        )
      }
      return await query<any>(
        'SELECT id, name, role FROM users WHERE store_id = ? AND (role = ? OR id = ?) ORDER BY id',
        [storeId, 'clerk', auth.userId]
      )
    })(),
    query<any>(
      `SELECT COUNT(*) AS c FROM orders WHERE store_id = ? AND created_at >= ? AND created_at < ? AND operator_id IS NULL`,
      [storeId, start, end]
    ),
  ])

  const salesMap = new Map<number, any>()
  for (const r of orderRows) salesMap.set(Number(r.operator_id), r)
  const rechargeMap = new Map<number, number>()
  for (const r of rechargeRows) rechargeMap.set(Number(r.operator_id), Number(r.v) || 0)
  const countMap = new Map<number, number>()
  for (const r of countRows) countMap.set(Number(r.operator_id), Number(r.v) || 0)
  const manualMap = new Map<number, number>()
  for (const r of manualRows) manualMap.set(Number(r.operator_id), Number(r.v) || 0)

  const items = (users || []).map((u: any) => {
    const id = Number(u.id)
    const o = salesMap.get(id)
    const sales = Number(o?.sales || 0)
    const returns = Number(o?.returns || 0)
    const recharge = rechargeMap.get(id) || 0
    const countUsage = countMap.get(id) || 0
    const manualConsume = manualMap.get(id) || 0
    return {
      user_id: id,
      name: u.name,
      role: u.role,
      sales: round2(sales),
      returns: round2(returns),
      net_sales: round2(sales - returns),
      order_count: Number(o?.cnt || 0),
      recharge: round2(recharge),
      count_usage: round2(countUsage),
      manual_consume: round2(manualConsume),
      service: round2(countUsage + manualConsume),
    }
  })

  return {
    items,
    range: { from, to },
    excluded_null: Number((nullRow as any)?.[0]?.c || 0),
  }
})
