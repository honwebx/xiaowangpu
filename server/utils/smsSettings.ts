import { execute, queryOne } from './db'

export const SMS_SETTINGS_ID = 1

const DEFAULTS: Record<string, any> = {
  sms_provider: null,
  sms_access_key: null,
  sms_secret: null,
  sms_sign_name: null,
  sms_sdk_app_id: null,
  sms_region: null,
  sms_enabled_balance: 0,
  sms_template_balance: null,
  sms_enabled_count: 0,
  sms_template_count: null,
  sms_enabled_points: 0,
  sms_template_points: null,
  sms_code_login: 0,
  sms_template_code: null,
  sms_code_daily_limit: 10,
  sms_code_expiry_min: 5,
}

export function defaultSmsSettings(): Record<string, any> {
  return { id: SMS_SETTINGS_ID, ...DEFAULTS }
}

export async function loadSmsSettings(): Promise<any> {
  let row = await queryOne<any>('SELECT * FROM sms_settings WHERE id = ?', [SMS_SETTINGS_ID])
  if (!row) {
    await execute(`INSERT OR IGNORE INTO sms_settings (id) VALUES (?)`, [SMS_SETTINGS_ID])
    row = await queryOne<any>('SELECT * FROM sms_settings WHERE id = ?', [SMS_SETTINGS_ID])
    if (!row) return defaultSmsSettings()
  }
  return { ...defaultSmsSettings(), ...row }
}
