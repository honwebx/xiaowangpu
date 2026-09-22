import { queryOne } from '../../../utils/db'
import { getAuth, ensureStoreAccess } from '../../../utils/auth'
import { createReturn } from '../../../services/returnService'

export default defineEventHandler(async (event) => {
  const auth = getAuth(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, message: '缺少订单ID' })

  const order = await queryOne<{ store_id: number }>('SELECT store_id FROM orders WHERE id = ?', [id])
  if (!order) throw createError({ statusCode: 404, message: '订单不存在' })
  ensureStoreAccess(event, Number(order.store_id))

  const body = await readBody(event)
  const result = await createReturn({
    original_order_id: id,
    items: body?.items || [],
    operator_id: auth.userId,
    refund_amount: body?.refund_amount != null ? Number(body.refund_amount) : undefined,
    idempotency_key: body?.idempotency_key ? String(body.idempotency_key).slice(0, 64) : undefined,
    event,
  })

  return result
})
