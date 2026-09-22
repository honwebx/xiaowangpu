import { query, queryOne } from '../../../utils/db'
import { ensureStoreAccess, getAuth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, message: '缺少商品ID' })
  const product = await queryOne<any>('SELECT store_id FROM products WHERE id = ?', [id])
  if (!product) throw createError({ statusCode: 404, message: '商品不存在' })
  ensureStoreAccess(event, Number(product.store_id))

  const q = getQuery(event)
  const limit = Math.min(Number(q.limit) || 100, 500)
  const logs = await query<any>(
    `SELECT l.*, u.name AS operator_name
       FROM product_stock_logs l LEFT JOIN users u ON u.id = l.operator_id
      WHERE l.product_id = ? ORDER BY l.id DESC LIMIT ?`,
    [id, limit]
  )
  if (getAuth(event).role === 'clerk') {
    return logs.map((l: any) => ({ ...l, cost_price: null }))
  }
  return logs
})
