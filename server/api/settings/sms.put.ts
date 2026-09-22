import { execute } from '../../utils/db'
import { requireAdmin } from '../../utils/auth'
import { SMS_SETTINGS_ID, loadSmsSettings } from '../../utils/smsSettings'

const NUMERIC_FIELDS = [
  'sms_enabled_balance',
  'sms_enabled_count',
  'sms_enabled_points',
  'sms_code_login',
  'sms_code_daily_limit',
  'sms_code_expiry_min',
]
const TEXT_FIELDS = [
  'sms_provider',
  'sms_access_key',
  'sms_secret',
  'sms_sign_name',
  'sms_sdk_app_id',
  'sms_region',
  'sms_template_balance',
  'sms_template_count',
  'sms_template_points',
  'sms_template_code',
]

const NUMERIC_RANGES: Record<string, { min?: number; max?: number; integer?: boolean }> = {
  sms_enabled_balance: { min: 0, max: 1, integer: true },
  sms_enabled_count: { min: 0, max: 1, integer: true },
  sms_enabled_points: { min: 0, max: 1, integer: true },
  sms_code_login: { min: 0, max: 1, integer: true },
  sms_code_daily_limit: { min: 1, integer: true },
  sms_code_expiry_min: { min: 1, integer: true },
}

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const body = await readBody(event)

  const pairs: string[] = []
  const values: any[] = []
  for (const f of NUMERIC_FIELDS) {
    if (body[f] === undefined) continue
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
    pairs.push(`${f} = ?`)
    values.push(n)
  }
  for (const f of TEXT_FIELDS) {
    if (body[f] === undefined) continue
    pairs.push(`${f} = ?`)
    values.push(body[f] || null)
  }

  if (pairs.length > 0) {
    await execute(`INSERT OR IGNORE INTO sms_settings (id) VALUES (?)`, [SMS_SETTINGS_ID])
    await execute(`UPDATE sms_settings SET ${pairs.join(', ')} WHERE id = ?`, [...values, SMS_SETTINGS_ID])
  } else {
    await execute(`INSERT OR IGNORE INTO sms_settings (id) VALUES (?)`, [SMS_SETTINGS_ID])
  }

  return await loadSmsSettings()
})
