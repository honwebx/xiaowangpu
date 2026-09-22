import { signToken, verifyToken, getAuthFromHeader } from '../../utils/auth'
import { queryOne } from '../../utils/db'
import { invalidateUserVersion } from '../../utils/cache'

export default defineEventHandler(async (event) => {
  const token = getAuthFromHeader(event)
  if (!token) throw createError({ statusCode: 401, message: '未登录' })
  let auth: any
  try {
    auth = await verifyToken(token)
  } catch {
    throw createError({ statusCode: 401, message: '登录已过期' })
  }
  const row = await queryOne<{ id: number; store_id: number | null; name: string; phone: string; role: string; status: string; token_version: number }>(
    'SELECT id, store_id, name, phone, role, status, token_version FROM users WHERE id = ?',
    [auth.userId],
  )
  if (!row) {
    invalidateUserVersion(auth.userId)
    throw createError({ statusCode: 401, message: '账号不存在，请重新登录' })
  }
  if (row.status === 'inactive') {
    invalidateUserVersion(auth.userId)
    throw createError({ statusCode: 403, message: '账号已停用，请联系管理员' })
  }
  if (auth.tokenVersion !== undefined && Number(row.token_version) !== auth.tokenVersion) {
    invalidateUserVersion(auth.userId)
    throw createError({ statusCode: 401, message: '登录状态已变更，请重新登录' })
  }
  const newToken = await signToken({
    userId: row.id,
    role: row.role as any,
    name: row.name,
    phone: row.phone,
    storeId: row.store_id,
    status: row.status,
    tokenVersion: Number(row.token_version),
  })
  return { token: newToken, expiresIn: 2 * 3600 }
})
