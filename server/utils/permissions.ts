import type { H3Event } from 'h3'
import type { Role } from '../../types'
import type { JwtPayload } from './auth'
import { getAuth } from './auth'

export type PermissionKey =
  | 'member.recharge'
  | 'member.consume'
  | 'member.assign-service'
  | 'member.deduct'
  | 'member.adjust-points'
  | 'member.revert-balance'
  | 'member.revert-deduct'
  | 'count-service.crud'
  | 'backup.crud'
  | 'sms.config'

const ROLE_RULES: Record<PermissionKey, Role[]> = {
  'member.recharge':       ['admin', 'manager', 'clerk'],
  'member.consume':        ['admin', 'manager', 'clerk'],
  'member.assign-service': ['admin', 'manager', 'clerk'],
  'member.deduct':         ['admin', 'manager', 'clerk'],
  'member.adjust-points':  ['admin', 'manager', 'clerk'],
  'member.revert-balance': ['admin', 'manager', 'clerk'],
  'member.revert-deduct':  ['admin', 'manager', 'clerk'],
  'count-service.crud':    ['admin', 'manager'],
  'backup.crud':           ['admin'],
  'sms.config':            ['admin'],
}

export interface PermissionContext {
  operatorId?: number
  targetOperatorId?: number
}

export function hasRole(perm: PermissionKey, role: Role): boolean {
  return ROLE_RULES[perm].includes(role)
}

export function requirePermission(
  event: H3Event,
  perm: PermissionKey,
  ctx?: PermissionContext
): JwtPayload {
  const auth = getAuth(event)
  if (!hasRole(perm, auth.role)) {
    throw createError({ statusCode: 403, message: '无权限' })
  }
  if (auth.role === 'clerk' && (perm === 'member.revert-balance' || perm === 'member.revert-deduct')) {
    if (ctx?.targetOperatorId == null || ctx.targetOperatorId !== auth.userId) {
      throw createError({ statusCode: 403, message: '只能反悔自己操作的记录' })
    }
  }
  return auth
}
