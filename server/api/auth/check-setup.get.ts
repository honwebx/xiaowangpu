import { query, queryOne } from '../../utils/db'
import { loadSmsSettings } from '../../utils/smsSettings'

export default defineEventHandler(async () => {
  const row = await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM users')
  const needSetup = !row || Number(row.c) === 0
  const stores = await query<{ id: number; name: string }>('SELECT id, name FROM stores ORDER BY id')
  const sms = await loadSmsSettings().catch(() => null)
  const smsCodeLoginEnabled =
    !!sms && Number(sms.sms_code_login) === 1 && !!sms.sms_provider && !!sms.sms_template_code
  return { needSetup, stores, smsCodeLoginEnabled }
})
