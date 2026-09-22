import { batch, queryOne } from '../../../utils/db'
import { ensureStoreAccess } from '../../../utils/auth'
import { requirePermission } from '../../../utils/permissions'
import { notifyInBackground } from '../../../utils/sms/notify'
import { findIdempotentLog, isUniqueConflict } from '../../../utils/idempotency'

export default defineEventHandler(async (event) => {
  const auth = requirePermission(event, 'member.adjust-points')
  const memberId = Number(getRouterParam(event, 'id'))
  if (!memberId) throw createError({ statusCode: 400, message: '缺少会员ID' })

  const body = await readBody(event)
  const amount = Number(body?.amount)
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
    throw createError({ statusCode: 400, message: '请输入正确的赠送数量' })
  }

  const member = await queryOne<any>('SELECT id, store_id, phone, points FROM members WHERE id = ?', [memberId])
  if (!member) throw createError({ statusCode: 404, message: '会员不存在' })
  ensureStoreAccess(event, Number(member.store_id))

  const notes = String(body?.notes || '').trim()
  const idempotencyKey = body?.idempotency_key ? String(body.idempotency_key).slice(0, 64) : ''
  if (!idempotencyKey) throw createError({ statusCode: 400, message: '缺少幂等键，请重试' })
  const storeId = Number(member.store_id)
  const existing = await findIdempotentLog(storeId, idempotencyKey, 'point_logs')
  if (existing) return { points: Number(existing.balance_after) }

  try {
    await batch([
      {
        sql: 'UPDATE members SET points = points + ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ?',
        params: [amount, memberId],
      },
      {
        sql: `INSERT INTO point_logs (member_id, store_id, type, amount, balance_after, operator_id, notes, idempotency_key, created_at)
              VALUES (?, ?, 'earn', ?, (SELECT points FROM members WHERE id = ?), ?, ?, ?, datetime('now', '+8 hours'))`,
        params: [memberId, storeId, amount, memberId, auth.userId, notes || null, idempotencyKey],
      },
    ])
  } catch (err) {
    if (isUniqueConflict(err)) {
      const dup = await findIdempotentLog(storeId, idempotencyKey, 'point_logs')
      if (dup) return { points: Number(dup.balance_after) }
    }
    throw err
  }

  const after = await queryOne<{ points: number }>('SELECT points FROM members WHERE id = ?', [memberId])
  const newPoints = Number(after?.points ?? 0)

  notifyInBackground(event, storeId, member.phone, 'points', {
    points: String(amount),
    balance: String(newPoints),
  })

  return { points: newPoints }
})