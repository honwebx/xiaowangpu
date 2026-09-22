import { execute, queryOne } from '../../utils/db'
import { requireManagerUp, ensureStoreAccess } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  requireManagerUp(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, message: '缺少商品ID' })

  const product = await queryOne<any>('SELECT * FROM products WHERE id = ?', [id])
  if (!product) throw createError({ statusCode: 404, message: '商品不存在' })
  ensureStoreAccess(event, Number(product.store_id))

  const [used, hasLogs] = await Promise.all([
    queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM order_items WHERE product_id = ?', [id]),
    queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM product_stock_logs WHERE product_id = ?', [id]),
  ])
  if (used && Number(used.c) > 0) {
    throw createError({ statusCode: 400, message: '该商品已有订单记录，无法删除' })
  }
  if (hasLogs && Number(hasLogs.c) > 0) {
    throw createError({ statusCode: 400, message: '该商品已有库存记录，无法删除' })
  }

  await execute('DELETE FROM products WHERE id = ?', [id])
  return { success: true, action: 'deleted' }
})