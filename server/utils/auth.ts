import { SignJWT, jwtVerify } from 'jose'
import type { Role } from '../../types'

export interface JwtPayload {
  userId: number
  role: Role
  name: string
  phone: string
  storeId: number | null
  status?: string
  tokenVersion?: number
}

const ALG = 'HS256'
const TOKEN_TTL = '2h'

function getSecret(): Uint8Array {
  const secret = useRuntimeConfig().jwtSecret
  if (!secret) {
    throw createError({ statusCode: 500, message: 'JWT_SECRET 未配置，请设置 NUXT_JWT_SECRET 环境变量' })
  }
  return new TextEncoder().encode(secret)
}

export async function signToken(payload: JwtPayload): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .setIssuer('xiaowangpu')
    .sign(getSecret())
}

export async function verifyToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, getSecret(), { issuer: 'xiaowangpu' })
  return payload as unknown as JwtPayload
}

export function getAuthFromHeader(event: any): string | null {
  const header = getHeader(event, 'authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : null
}

export function getAuth(event: any): JwtPayload {
  const auth = event?.context?.auth as JwtPayload | undefined
  if (!auth || !auth.userId) {
    throw createError({ statusCode: 401, message: '未登录' })
  }
  return auth
}

export function requireRole(event: any, ...roles: Role[]): JwtPayload {
  const auth = getAuth(event)
  if (!roles.includes(auth.role)) {
    throw createError({ statusCode: 403, message: '无权限' })
  }
  return auth
}

export function requireAdmin(event: any): JwtPayload {
  return requireRole(event, 'admin')
}

export function requireManagerUp(event: any): JwtPayload {
  return requireRole(event, 'admin', 'manager')
}

export function resolveStoreId(event: any, queryStoreId?: number | string | null): number | null {
  const auth = getAuth(event)
  if (auth.role === 'admin') {
    if (queryStoreId === undefined || queryStoreId === null || queryStoreId === '') return null
    return Number(queryStoreId)
  }
  return auth.storeId
}

export function ensureStoreAccess(event: any, storeId: number): void {
  const auth = getAuth(event)
  if (auth.role === 'admin') return
  if (auth.storeId !== storeId) {
    throw createError({ statusCode: 403, message: '无权访问该店铺' })
  }
}
