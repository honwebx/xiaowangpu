import { queryOne } from '../../utils/db'
import { ensureStoreAccess, getAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, message: '缺少订单ID' })

  const order = await queryOne<any>(
    `SELECT o.*, m.name AS member_name, m.phone AS member_phone, u.name AS operator_name
       FROM orders o
       LEFT JOIN members m ON m.id = o.member_id
       LEFT JOIN users u ON u.id = o.operator_id
      WHERE o.id = ?`,
    [id]
  )
  if (!order) throw createError({ statusCode: 404, message: '订单不存在' })
  ensureStoreAccess(event, Number(order.store_id))
  const isClerk = getAuth(event).role === 'clerk'

  // 单条 SQL：items 内联已退数量（sale 才有 returnable_quantity）；预聚合 LEFT JOIN 替代逐行相关子查询
  if (order.type === 'sale') {
    const items = await queryOne<any>(
      `SELECT json_group_array(json_object(
         'id', oi.id, 'order_id', oi.order_id, 'product_id', oi.product_id,
         'product_name', oi.product_name, 'product_unit', oi.product_unit,
         'unit_price', oi.unit_price, 'original_price', oi.original_price,
         'quantity', oi.quantity, 'base_quantity', oi.base_quantity, 'base_unit', oi.base_unit,
         'subtotal', oi.subtotal, 'discount_amount', oi.discount_amount, 'cost_price', oi.cost_price,
         'count_service_id', oi.count_service_id, 'created_at', oi.created_at,
         'returnable_quantity', oi.base_quantity - COALESCE(ret.total_returned, 0)
       )) AS items
       FROM order_items oi
       LEFT JOIN (
         SELECT COALESCE(rt.product_id, 0) AS pid,
                COALESCE(rt.count_service_id, 0) AS csid,
                SUM(rt.base_quantity) AS total_returned
           FROM order_items rt
           JOIN orders ro ON ro.id = rt.order_id
          WHERE ro.type = 'return' AND ro.original_order_id = ?
          GROUP BY pid, csid
       ) ret ON ret.pid = COALESCE(oi.product_id, 0) AND ret.csid = COALESCE(oi.count_service_id, 0)
      WHERE oi.order_id = ?
      ORDER BY oi.id`,
      [id, id]
    )
    const parsed = items?.items ? JSON.parse(items.items) : []
    const masked = isClerk ? parsed.map((it: any) => ({ ...it, cost_price: null })) : parsed
    return { ...order, items: masked }
  }

  const items = await queryOne<any>(
    `SELECT json_group_array(json_object(
       'id', oi.id, 'order_id', oi.order_id, 'product_id', oi.product_id,
       'product_name', oi.product_name, 'product_unit', oi.product_unit,
       'unit_price', oi.unit_price, 'original_price', oi.original_price,
       'quantity', oi.quantity, 'base_quantity', oi.base_quantity, 'base_unit', oi.base_unit,
       'subtotal', oi.subtotal, 'discount_amount', oi.discount_amount, 'cost_price', oi.cost_price,
       'count_service_id', oi.count_service_id, 'created_at', oi.created_at
     )) AS items
     FROM order_items oi
     WHERE oi.order_id = ?
     ORDER BY oi.id`,
    [id]
  )
  const parsed = items?.items ? JSON.parse(items.items) : []
  const masked = isClerk ? parsed.map((it: any) => ({ ...it, cost_price: null })) : parsed
  return { ...order, items: masked }
})
