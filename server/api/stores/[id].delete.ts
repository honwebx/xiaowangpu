import { batch, queryOne } from '../../utils/db'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, message: '缺少店铺ID' })

  const totalRow = await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM stores')
  const total = Number(totalRow?.c || 0)
  if (total <= 1) {
    throw createError({ statusCode: 400, message: '系统至少保留一个店铺，无法删除' })
  }

  const results = await batch([
    { sql: 'DELETE FROM sms_codes WHERE store_id = ?', params: [id] },
    { sql: 'DELETE FROM product_stock_logs WHERE store_id = ?', params: [id] },
    {
      sql: 'DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE store_id = ?)',
      params: [id],
    },
    { sql: 'DELETE FROM orders WHERE store_id = ?', params: [id] },
    {
      sql: 'DELETE FROM count_usage_logs WHERE member_service_id IN (SELECT id FROM member_count_services WHERE store_id = ?)',
      params: [id],
    },
    { sql: 'DELETE FROM member_count_services WHERE store_id = ?', params: [id] },
    { sql: 'DELETE FROM balance_logs WHERE store_id = ?', params: [id] },
    { sql: 'DELETE FROM point_logs WHERE store_id = ?', params: [id] },
    {
      sql: 'DELETE FROM count_services WHERE store_id = ?',
      params: [id],
    },
    { sql: 'DELETE FROM products WHERE store_id = ?', params: [id] },
    { sql: 'DELETE FROM members WHERE store_id = ?', params: [id] },
    { sql: 'DELETE FROM settings WHERE store_id = ?', params: [id] },
    { sql: 'DELETE FROM users WHERE store_id = ?', params: [id] },
    { sql: 'DELETE FROM stores WHERE id = ? AND (SELECT COUNT(*) FROM stores) > 1', params: [id] },
  ])

  const storeResult = results[results.length - 1]
  if (!storeResult?.meta?.changes) {
    const exists = await queryOne<{ id: number }>('SELECT id FROM stores WHERE id = ?', [id])
    if (!exists) throw createError({ statusCode: 404, message: '店铺不存在' })
    throw createError({ statusCode: 400, message: '系统至少保留一个店铺，无法删除' })
  }

  return { success: true }
})
