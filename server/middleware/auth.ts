import { verifyToken, getAuthFromHeader } from '../utils/auth'
import { ensureSchema } from '../utils/schema'
import { queryOne } from '../utils/db'
import { getCachedUserVersion, setCachedUserVersion } from '../utils/cache'

export default defineEventHandler(async (event) => {
  const path = event.path || ''
  if (!path.startsWith('/api/')) return
  await ensureSchema()
  if (path === '/api/auth/login' || path === '/api/auth/send-code' || path === '/api/auth/sms-login' || path === '/api/auth/check-setup' || path === '/api/auth/refresh' || path === '/api/setup') return
  const token = getAuthFromHeader(event)
  if (!token) throw createError({ statusCode: 401, message: '未登录' })
  let payload
  try {
    payload = await verifyToken(token)
  } catch {
    throw createError({ statusCode: 401, message: '登录已过期' })
  }
  if ((payload.status || 'active') === 'inactive') {
    throw createError({ statusCode: 403, message: '账号已停用，请联系管理员' })
  }
  // 校验 token_version：与库中最新版本对比，支持即时撤销（停用/改密/改角色后旧 token 立即失效）
  // 无版本号的老 token 直接失效，强制重新登录
  if (payload.tokenVersion == null) {
    throw createError({ statusCode: 401, message: '登录状态已变更，请重新登录' })
  }
  let cur = getCachedUserVersion(payload.userId)
  if (cur === undefined) {
    const row = await queryOne<{ token_version: number; status: string }>(
      'SELECT token_version, status FROM users WHERE id = ?',
      [payload.userId],
    )
    cur = row ? { version: Number(row.token_version), status: row.status } : null
    setCachedUserVersion(payload.userId, cur)
  }
  if (!cur) {
    throw createError({ statusCode: 401, message: '账号已失效，请重新登录' })
  }
  if (cur.status === 'inactive') {
    throw createError({ statusCode: 403, message: '账号已停用，请联系管理员' })
  }
  if (cur.version !== payload.tokenVersion) {
    throw createError({ statusCode: 401, message: '登录状态已变更，请重新登录' })
  }
  event.context.auth = payload
})
