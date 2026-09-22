import { execute, queryOne } from '../../utils/db'
import { requireManagerUp, ensureStoreAccess } from '../../utils/auth'

const NUMERIC_FIELDS = [
  'vip_discount_rate',
  'points_earn_rate',
  'points_redeem_amount',
  'points_redeem_value',
  'balance_payment_enabled',
  'points_payment_enabled',
  'default_stock_alert',
]
const NUMERIC_RANGES: Record<string, { min?: number; max?: number; integer?: boolean }> = {
  vip_discount_rate: { min: 0, max: 1 },
  points_earn_rate: { min: 0 },
  points_redeem_amount: { min: 1, integer: true },
  points_redeem_value: { min: 0 },
  balance_payment_enabled: { min: 0, max: 1, integer: true },
  points_payment_enabled: { min: 0, max: 1, integer: true },
  default_stock_alert: { min: 0 },
}

export default defineEventHandler(async (event) => {
  requireManagerUp(event)
  const body = await readBody(event)
  const storeId = Number(body?.store_id)
  if (!storeId) throw createError({ statusCode: 400, message: '缺少店铺' })
  ensureStoreAccess(event, storeId)

  // 短信改为全局单例表 sms_settings（仅 admin 经 GET/PUT /api/settings/sms 读写），此处忽略 sms_* 字段
  const updatePairs: string[] = []
  const updateValues: any[] = []
  for (const f of NUMERIC_FIELDS) {
    if (body[f] !== undefined) {
      const raw = body[f]
      const n = raw === '' || raw === null ? NaN : Number(raw)
      if (!Number.isFinite(n)) {
        throw createError({ statusCode: 400, message: `${f} 必须是数字` })
      }
      const r = NUMERIC_RANGES[f]
      if (r?.integer && !Number.isInteger(n)) {
        throw createError({ statusCode: 400, message: `${f} 必须为整数` })
      }
      if (r?.min != null && n < r.min) {
        throw createError({ statusCode: 400, message: `${f} 不能小于 ${r.min}` })
      }
      if (r?.max != null && n > r.max) {
        throw createError({ statusCode: 400, message: `${f} 不能大于 ${r.max}` })
      }
      updatePairs.push(`${f} = ?`)
      updateValues.push(n)
    }
  }
  if (updatePairs.length > 0) {
    const insertCols = ['store_id', ...updatePairs.map(p => p.split(' = ')[0])]
    const insertPlaceholders = insertCols.map(() => '?').join(', ')
    const insertValues = [storeId, ...updateValues]
    const updateSql = updatePairs.join(', ')
    await execute(
      `INSERT INTO settings (${insertCols.join(', ')}) VALUES (${insertPlaceholders})
       ON CONFLICT(store_id) DO UPDATE SET ${updateSql}`,
      [...insertValues, ...updateValues]
    )
  } else {
    await execute('INSERT OR IGNORE INTO settings (store_id) VALUES (?)', [storeId])
  }

  // 设置变更后 dashboard 缓存靠 60s TTL 自然过期

  const updated = await queryOne('SELECT * FROM settings WHERE store_id = ?', [storeId])
  return updated
})
