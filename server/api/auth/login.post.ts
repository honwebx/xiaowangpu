import { queryOne } from '../../utils/db'
import { verifyPassword } from '../../utils/crypto'
import { checkLoginAllowed, recordLoginFailure, resetLoginThrottle, throttleKey, clientIp } from '../../utils/loginThrottle'
import { loadUserByPhone, issueAuthResponse, signAndFormat, loadStoresForUser } from '../../utils/authContext'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const phone = String(body?.phone || '').trim()
  const password = String(body?.password || '')
  const storeIdRaw = body?.storeId
  const storeId = storeIdRaw === null || storeIdRaw === undefined || storeIdRaw === '' ? null : Number(storeIdRaw)

  if (!phone || !password) {
    throw createError({ statusCode: 400, message: '请输入手机号和密码' })
  }
  if (!/^1\d{10}$/.test(phone)) {
    throw createError({ statusCode: 400, message: '手机号格式不正确' })
  }
  if (storeId !== null && (!Number.isInteger(storeId) || storeId <= 0)) {
    throw createError({ statusCode: 400, message: '店铺参数无效' })
  }

  const key = throttleKey(clientIp(event), phone, storeId)
  await checkLoginAllowed(key)

  const user = await loadUserByPhone(phone, storeId)
  if (!user) {
    await recordLoginFailure(key)
    throw createError({ statusCode: 401, message: '手机号或密码错误' })
  }
  if (user.status === 'inactive') {
    await recordLoginFailure(key)
    throw createError({ statusCode: 401, message: '手机号或密码错误' })
  }

  const fullUser = await queryOne<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [user.id])
  const valid = await verifyPassword(password, fullUser!.password_hash)
  if (!valid) {
    await recordLoginFailure(key)
    throw createError({ statusCode: 401, message: '手机号或密码错误' })
  }
  await resetLoginThrottle(key)

  // admin 指定 storeId 时与 sms-login 行为对齐：校验 storeId 在 stores 列表中
  if (user.role === 'admin' && storeId != null) {
    const { stores, defaultStoreId } = await loadStoresForUser(user, storeId)
    return await signAndFormat(user, stores, defaultStoreId)
  }
  return await issueAuthResponse(user, storeId)
})
