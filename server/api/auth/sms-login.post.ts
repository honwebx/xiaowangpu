import { verifyCode } from '../../utils/sms'
import { loadSmsSettings } from '../../utils/smsSettings'
import { loadUserByPhone, issueAuthResponse } from '../../utils/authContext'
import { checkLoginAllowed, recordLoginFailure, resetLoginThrottle, throttleKey, clientIp } from '../../utils/loginThrottle'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const phone = String(body?.phone || '').trim()
  const code = String(body?.code || '')
  const storeIdRaw = body?.storeId
  const storeId = storeIdRaw === null || storeIdRaw === undefined || storeIdRaw === '' ? null : Number(storeIdRaw)

  if (!phone || !code) {
    throw createError({ statusCode: 400, message: '请输入手机号和验证码' })
  }
  if (!/^1\d{10}$/.test(phone)) {
    throw createError({ statusCode: 400, message: '手机号格式不正确' })
  }
  if (storeId !== null && (!Number.isInteger(storeId) || storeId <= 0)) {
    throw createError({ statusCode: 400, message: '店铺参数无效' })
  }
  const smsRow: any = await loadSmsSettings().catch(() => null)
  const smsEnabled =
    smsRow && Number(smsRow.sms_code_login) === 1 && smsRow.sms_provider && smsRow.sms_template_code
  if (!smsEnabled && !import.meta.dev) {
    throw createError({ statusCode: 403, message: '验证码登录未开启' })
  }

  const key = throttleKey(clientIp(event), phone, storeId)
  await checkLoginAllowed(key)

  if (!(await verifyCode(phone, code))) {
    await recordLoginFailure(key)
    throw createError({ statusCode: 401, message: '验证码错误或已过期' })
  }

  const user = await loadUserByPhone(phone, storeId)
  if (!user) {
    await recordLoginFailure(key)
    throw createError({ statusCode: 401, message: '账号不存在或已停用' })
  }
  if (user.status === 'inactive') {
    await recordLoginFailure(key)
    throw createError({ statusCode: 401, message: '账号不存在或已停用' })
  }

  await resetLoginThrottle(key)
  return await issueAuthResponse(user, storeId)
})
