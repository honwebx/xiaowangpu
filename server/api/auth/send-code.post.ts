import { buildSmsConfig, sendCode } from '../../utils/sms'
import { loadSmsSettings } from '../../utils/smsSettings'
import { checkSendCodeAllowed, recordSendCode, clientIp } from '../../utils/loginThrottle'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const phone = String(body?.phone || '').trim()
  if (!/^1\d{10}$/.test(phone)) {
    throw createError({ statusCode: 400, message: '手机号格式不正确' })
  }

  await checkSendCodeAllowed(clientIp(event))
  await recordSendCode(clientIp(event))

  // 短信全局共享：读单例表 sms_settings，不分店
  const row: any = await loadSmsSettings()
  const enabled = row && Number(row.sms_code_login) === 1 && row.sms_provider && row.sms_template_code
  if (!enabled && !import.meta.dev) {
    throw createError({ statusCode: 403, message: '验证码登录未开启' })
  }

  const result = await sendCode(phone, {
    dailyLimit: row ? Number(row.sms_code_daily_limit) || 10 : undefined,
    expiryMin: row ? Number(row.sms_code_expiry_min) || 5 : undefined,
    config: buildSmsConfig(row),
    templateCode: row?.sms_template_code || undefined,
    storeId: null,
  })

  return {
    success: true,
    sent: result.sent,
    via: result.via,
    code: result.code,
    expiresIn: result.expiresIn,
  }
})
