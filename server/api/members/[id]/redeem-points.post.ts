import { execute, queryOne } from '../../../utils/db'
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
    throw createError({ statusCode: 400, message: '请输入正确的兑换数量' })
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

  const updRes = await execute(
    'UPDATE members SET points = points - ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND points >= ? RETURNING points',
    [amount, memberId, amount]
  )
  if (!updRes?.meta?.changes) {
    throw createError({ statusCode: 400, message: '积分不足' })
  }
  const newPoints = Number(updRes?.results?.[0]?.points ?? 0)
  try {
    await execute(
      `INSERT INTO point_logs (member_id, store_id, type, amount, balance_after, operator_id, notes, idempotency_key, created_at) VALUES (?, ?, 'redeem', ?, ?, ?, ?, ?, datetime('now', '+8 hours'))`,
      [memberId, storeId, amount, newPoints, auth.userId, notes || null, idempotencyKey]
    )
  } catch (err) {
    if (isUniqueConflict(err)) {
      const existing = await findIdempotentLog(storeId, idempotencyKey, 'point_logs')
      if (existing) return { points: Number(existing.balance_after) }
    }
    await execute('UPDATE members SET points = points + ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ?', [amount, memberId]).catch(() => {})
    throw err
  }

  notifyInBackground(event, storeId, member.phone, 'points', {
    points: String(amount),
    balance: String(newPoints),
  })

  return { points: newPoints }
})