import { execute, queryOne, round2 } from '../../../utils/db'
import { ensureStoreAccess } from '../../../utils/auth'
import { requirePermission } from '../../../utils/permissions'
import { findIdempotentLog, isUniqueConflict } from '../../../utils/idempotency'

export default defineEventHandler(async (event) => {
  requirePermission(event, 'member.assign-service')
  const memberId = Number(getRouterParam(event, 'id'))
  if (!memberId) throw createError({ statusCode: 400, message: '缺少会员ID' })

  const body = await readBody(event)
  const serviceId = Number(body?.service_id)
  if (!serviceId) throw createError({ statusCode: 400, message: '请选择计次项目' })

  const member = await queryOne<any>('SELECT id, store_id FROM members WHERE id = ?', [memberId])
  if (!member) throw createError({ statusCode: 404, message: '会员不存在' })
  ensureStoreAccess(event, Number(member.store_id))

  const service = await queryOne<any>('SELECT * FROM count_services WHERE id = ? AND store_id = ?', [serviceId, member.store_id])
  if (!service) throw createError({ statusCode: 404, message: '计次项目不存在' })
  if (service.status === 'inactive') throw createError({ statusCode: 400, message: '该计次项目已停用，不可再售卖' })

  const paidAmount = body?.paid_amount != null && body?.paid_amount !== ''
    ? round2(Number(body.paid_amount))
    : round2(Number(service.price) || 0)
  if (paidAmount < 0) throw createError({ statusCode: 400, message: '实收金额不能为负' })

  const expiresAt = service.validity_months
    ? new Date(Date.now() + service.validity_months * 30 * 24 * 3600 * 1000).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
    : null

  const idempotencyKey = body?.idempotency_key ? String(body.idempotency_key).slice(0, 64) : ''
  if (!idempotencyKey) throw createError({ statusCode: 400, message: '缺少幂等键，请重试' })
  const existing = await findIdempotentLog(member.store_id, idempotencyKey, 'member_count_services')
  if (existing) return { success: true, id: (existing as any).id }

  let newId: number | null = null
  try {
    const res = await execute(
      `INSERT INTO member_count_services (member_id, store_id, service_id, remaining_count, paid_amount, purchased_at, expires_at, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', '+8 hours'), ?, ?, datetime('now', '+8 hours'))`,
      [memberId, member.store_id, serviceId, service.total_count, paidAmount, expiresAt, idempotencyKey]
    )
    newId = Number(res?.meta?.last_row_id ?? 0) || null
  } catch (err) {
    if (isUniqueConflict(err)) {
      const dup = await findIdempotentLog(member.store_id, idempotencyKey, 'member_count_services')
      if (dup) return { success: true, id: (dup as any).id }
    }
    throw err
  }

  return { success: true, id: newId }
})
