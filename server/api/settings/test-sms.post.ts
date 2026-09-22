import { requireAdmin, getAuth } from '../../utils/auth'
import { sendSms, generateCode } from '../../utils/sms'

const RATE_LIMIT_MS = 60_000
const lastSentAt = new Map<number, number>()

export default defineEventHandler(async (event) => {
  const auth = getAuth(event)
  requireAdmin(event)

  const last = lastSentAt.get(auth.userId) || 0
  const remain = RATE_LIMIT_MS - (Date.now() - last)
  if (remain > 0) {
    throw createError({
      statusCode: 429,
      message: `测试短信请 ${Math.ceil(remain / 1000)} 秒后再试`,
    })
  }

  const body = await readBody(event)
  const phone = String(body?.phone || '').trim()
  if (!/^1\d{10}$/.test(phone)) {
    throw createError({ statusCode: 400, message: '手机号格式不正确' })
  }

  const provider = body?.sms_provider
  const accessKey = body?.sms_access_key
  const secret = body?.sms_secret
  const signName = body?.sms_sign_name
  const sdkAppId = body?.sms_sdk_app_id
  const region = body?.sms_region
  const templateCode = body?.sms_template_code

  if (!provider) throw createError({ statusCode: 400, message: '请先选择服务商' })
  if (!accessKey || !secret || !signName) {
    throw createError({ statusCode: 400, message: '请先填写 AccessKey / Secret / 签名' })
  }
  if (provider === 'tencent' && !sdkAppId) {
    throw createError({ statusCode: 400, message: '腾讯云需填写 SDK AppId' })
  }
  if (!templateCode) throw createError({ statusCode: 400, message: '请先填写验证码模板 ID' })

  if (secret === '******' || accessKey === '******') {
    throw createError({ statusCode: 400, message: '请重新填写 AccessKey / Secret（当前为脱敏占位）' })
  }

  const code = generateCode()
  const result = await sendSms(
    { phone, templateCode, templateParams: { code } },
    { provider, accessKey, secret, signName, sdkAppId: sdkAppId || '', region: region || '', templates: {} },
  )

  if (result.success) {
    lastSentAt.set(auth.userId, Date.now())
  }

  return {
    success: result.success,
    error: result.error,
    code: import.meta.dev ? code : undefined,
  }
})
