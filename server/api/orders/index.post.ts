import { getAuth, ensureStoreAccess } from '../../utils/auth'
import { createOrder } from '../../services/orderService'

export default defineEventHandler(async (event) => {
  const auth = getAuth(event)
  const body = await readBody(event)
  const storeId = Number(body?.store_id)
  if (!storeId) throw createError({ statusCode: 400, message: '缺少店铺' })
  ensureStoreAccess(event, storeId)

  const result = await createOrder({
    store_id: storeId,
    member_id: body?.member_id ?? null,
    items: body?.items || [],
    cash_amount: Number(body?.cash_amount) || 0,
    balance_amount: Number(body?.balance_amount) || 0,
    points_amount: Number(body?.points_amount) || 0,
    order_discount: Number(body?.order_discount) || 0,
    operator_id: auth.userId,
    idempotency_key: body?.idempotency_key ? String(body.idempotency_key).slice(0, 64) : undefined,
    event,
  })

  return result
})
