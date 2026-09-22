import { execute, queryOne, round2 } from '../../../utils/db'
import { ensureStoreAccess } from '../../../utils/auth'
import { requirePermission } from '../../../utils/permissions'
import { notifyInBackground } from '../../../utils/sms/notify'
import { findIdempotentLog, isUniqueConflict } from '../../../utils/idempotency'

export default defineEventHandler(async (event) => {
  const auth = requirePermission(event, 'member.deduct')
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, message: '缺少会员ID' })

  const member = await queryOne<{ id: number; store_id: number; phone: string }>('SELECT id, store_id, phone FROM members WHERE id = ?', [id])
  if (!member) throw createError({ statusCode: 404, message: '会员不存在' })
  ensureStoreAccess(event, Number(member.store_id))

  const body = await readBody(event)
  const memberServiceId = Number(body?.member_service_id)
  const count = Math.floor(Number(body?.count))
  if (!memberServiceId) throw createError({ statusCode: 400, message: '缺少计次项目记录' })
  if (!count || count <= 0) throw createError({ statusCode: 400, message: '扣减次数必须大于0' })

  const idempotencyKey = body?.idempotency_key ? String(body.idempotency_key).slice(0, 64) : ''
  if (!idempotencyKey) throw createError({ statusCode: 400, message: '缺少幂等键，请重试' })
  const storeId = Number(member.store_id)
  if (idempotencyKey) {
    const existing = await findIdempotentLog<{ member_service_id: number; deduction_count: number; remaining_after: number; unit_amount: number | null }>(
      storeId, idempotencyKey, 'count_usage_logs'
    )
    if (existing) {
      return {
        member_service_id: Number(existing.member_service_id),
        remaining_count: Number(existing.remaining_after),
        unit_amount: Number(existing.unit_amount || 0),
      }
    }
  }

  const ms = await queryOne<{ id: number; member_id: number; remaining_count: number; paid_amount: number; expires_at: string | null }>(
    `SELECT mcs.id, mcs.member_id, mcs.remaining_count, mcs.paid_amount, mcs.expires_at,
            cs.total_count AS total_count, cs.price AS price
       FROM member_count_services mcs
       JOIN count_services cs ON cs.id = mcs.service_id
      WHERE mcs.id = ? AND mcs.member_id = ?`,
    [memberServiceId, id]
  )
  if (!ms) throw createError({ statusCode: 404, message: '计次项目记录不存在' })
  if (ms.expires_at && new Date(ms.expires_at.replace(' ', 'T') + '+08:00') < new Date()) {
    throw createError({ statusCode: 400, message: '该计次项目已过期' })
  }
  if (Number(ms.remaining_count) < count) {
    throw createError({ statusCode: 400, message: '剩余次数不足' })
  }

  const remainingSnapshot = Number(ms.remaining_count) - count
  const totalCount = Number((ms as any).total_count) || 0
  const unitAmount = totalCount > 0
    ? round2(((Number(ms.paid_amount) || 0) / totalCount) * count)
    : 0

  const updRes = await execute(
    'UPDATE member_count_services SET remaining_count = remaining_count - ? WHERE id = ? AND remaining_count >= ? RETURNING remaining_count',
    [count, ms.id, count]
  )
  if (!updRes?.meta?.changes) {
    throw createError({ statusCode: 400, message: '剩余次数不足' })
  }
  const remaining = Number(updRes?.results?.[0]?.remaining_count ?? remainingSnapshot)
  try {
    await execute(
      `INSERT INTO count_usage_logs (member_service_id, store_id, deduction_count, unit_amount, remaining_after, operator_id, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))`,
      [ms.id, storeId, count, unitAmount, remaining, auth.userId, idempotencyKey]
    )
  } catch (err) {
    if (isUniqueConflict(err) && idempotencyKey) {
      const existing = await findIdempotentLog<{ member_service_id: number; deduction_count: number; remaining_after: number; unit_amount: number | null }>(
        storeId, idempotencyKey, 'count_usage_logs'
      )
      if (existing) {
        return {
          member_service_id: Number(existing.member_service_id),
          remaining_count: Number(existing.remaining_after),
          unit_amount: Number(existing.unit_amount || 0),
        }
      }
    }
    await execute('UPDATE member_count_services SET remaining_count = remaining_count + ? WHERE id = ?', [count, ms.id]).catch(() => {})
    throw err
  }

  notifyInBackground(event, storeId, member.phone, 'count', {
    count: String(count),
    remaining: String(remaining),
  })

  return { member_service_id: ms.id, remaining_count: remaining, unit_amount: unitAmount }
})
