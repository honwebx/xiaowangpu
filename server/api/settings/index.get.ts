import { queryOne } from '../../utils/db'
import { resolveStoreId } from '../../utils/auth'

const DEFAULT_SETTINGS = {
  store_id: null,
  vip_discount_rate: 1,
  points_earn_rate: 1,
  points_redeem_amount: 100,
  points_redeem_value: 1,
  balance_payment_enabled: 1,
  points_payment_enabled: 1,
  default_stock_alert: 10,
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const storeId = resolveStoreId(event, (q.store_id as any) ?? null)
  if (!storeId) {
    return { ...DEFAULT_SETTINGS, store_id: null }
  }
  const row = await queryOne<any>('SELECT * FROM settings WHERE store_id = ?', [storeId])
  return row || { ...DEFAULT_SETTINGS, store_id: storeId }
})
