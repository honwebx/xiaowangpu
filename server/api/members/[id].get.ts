import { query, queryOne } from '../../utils/db'
import { ensureStoreAccess } from '../../utils/auth'

// ?include=point,balance,services,orders,usage（逗号分隔，缺省查全部）：
// 详情弹窗按 tab 懒加载，避免一次 6 个查询
const ALL_INCLUDES = ['point', 'balance', 'services', 'orders', 'usage'] as const

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, message: '缺少会员ID' })

  const member = await queryOne<any>('SELECT * FROM members WHERE id = ?', [id])
  if (!member) throw createError({ statusCode: 404, message: '会员不存在' })
  ensureStoreAccess(event, Number(member.store_id))

  const q = getQuery(event)
  const rawInclude = String(q.include || '').trim()
  const include = new Set(rawInclude ? rawInclude.split(',').map((s) => s.trim()).filter(Boolean) : [...ALL_INCLUDES])

  const tasks: Array<Promise<any>> = []
  const keys: string[] = []
  if (include.has('point')) {
    keys.push('pointLogs')
    tasks.push(query('SELECT p.id, p.member_id, p.store_id, p.type, p.amount, p.balance_after, p.related_order_id, p.operator_id, u.name AS operator_name, p.notes, p.created_at FROM point_logs p LEFT JOIN users u ON u.id = p.operator_id WHERE p.member_id = ? ORDER BY p.id DESC LIMIT 200', [id]))
  }
  if (include.has('balance')) {
    keys.push('balanceLogs')
    tasks.push(query('SELECT b.id, b.member_id, b.store_id, b.type, b.amount, b.bonus_amount, b.balance_after, b.related_order_id, b.source_log_id, b.operator_id, u.name AS operator_name, b.notes, b.created_at, (SELECT COALESCE(SUM(-r.amount), 0) FROM balance_logs r WHERE r.source_log_id = b.id) AS reverted_amount, (SELECT COALESCE(SUM(-r.bonus_amount), 0) FROM balance_logs r WHERE r.source_log_id = b.id) AS reverted_bonus FROM balance_logs b LEFT JOIN users u ON u.id = b.operator_id WHERE b.member_id = ? ORDER BY b.id DESC LIMIT 200', [id]))
  }
  if (include.has('services')) {
    keys.push('memberServices')
    tasks.push(query(
      `SELECT mcs.id, mcs.member_id, mcs.store_id, mcs.service_id, mcs.remaining_count, mcs.paid_amount, mcs.purchased_at, mcs.expires_at, mcs.created_at,
              COALESCE(cs.name, '已删除项目') AS service_name, cs.total_count, cs.validity_months
         FROM member_count_services mcs
         LEFT JOIN count_services cs ON cs.id = mcs.service_id
        WHERE mcs.member_id = ? ORDER BY mcs.id DESC`,
      [id]
    ))
  }
  if (include.has('orders')) {
    keys.push('orders')
    tasks.push(query(
      `SELECT o.id, o.type, o.total_amount, o.created_at, o.original_order_id
         FROM orders o WHERE o.member_id = ? ORDER BY o.id DESC LIMIT 100`,
      [id]
    ))
  }
  if (include.has('usage')) {
    keys.push('countUsageLogs')
    tasks.push(query(
      `SELECT cul.id, cul.member_service_id, cul.store_id, cul.deduction_count, cul.unit_amount,
              cul.remaining_after, cul.related_order_id, cul.operator_id, u.name AS operator_name, cul.created_at, mcs.member_id
         FROM count_usage_logs cul
         JOIN member_count_services mcs ON mcs.id = cul.member_service_id
         LEFT JOIN users u ON u.id = cul.operator_id
        WHERE mcs.member_id = ? ORDER BY cul.id DESC LIMIT 200`,
      [id]
    ))
  }
  const results = await Promise.all(tasks)
  const out: Record<string, any> = {}
  for (let i = 0; i < keys.length; i++) out[keys[i]] = results[i]

  return { ...member, pointLogs: [], balanceLogs: [], memberServices: [], orders: [], countUsageLogs: [], ...out }
})
