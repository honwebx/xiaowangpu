import { batch, queryOne, round2 } from '../../../utils/db'
import { ensureStoreAccess } from '../../../utils/auth'
import { requirePermission } from '../../../utils/permissions'
import { notifyInBackground } from '../../../utils/sms/notify'
import { findIdempotentLog, isUniqueConflict } from '../../../utils/idempotency'

export default defineEventHandler(async (event) => {
  const auth = requirePermission(event, 'member.recharge')
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, message: '缺少会员ID' })

  const member = await queryOne<any>('SELECT * FROM members WHERE id = ?', [id])
  if (!member) throw createError({ statusCode: 404, message: '会员不存在' })
  ensureStoreAccess(event, Number(member.store_id))

  const body = await readBody(event)
  const amount = round2(Number(body?.amount) || 0)
  if (amount <= 0) throw createError({ statusCode: 400, message: '充值金额必须大于0' })
  const bonusAmount = round2(Number(body?.bonus_amount) || 0)
  if (bonusAmount < 0) throw createError({ statusCode: 400, message: '赠送金额不能为负' })

  const notes = String(body?.notes || '').trim() || null
  const idempotencyKey = body?.idempotency_key ? String(body.idempotency_key).slice(0, 64) : ''
  if (!idempotencyKey) throw createError({ statusCode: 400, message: '缺少幂等键，请重试' })
  const storeId = Number(member.store_id)

  const existing = await findIdempotentLog(storeId, idempotencyKey, 'balance_logs')
  if (existing) return { id: Number((existing as any).member_id), balance: Number((existing as any).balance_after) }

  const delta = round2(amount + bonusAmount)
  try {
    await batch([
      {
        sql: 'UPDATE members SET balance = balance + ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ?',
        params: [delta, id],
      },
      {
        sql: `INSERT INTO balance_logs (member_id, store_id, type, amount, bonus_amount, balance_after, operator_id, notes, idempotency_key, created_at)
              VALUES (?, ?, 'recharge', ?, ?, (SELECT balance FROM members WHERE id = ?), ?, ?, ?, datetime('now', '+8 hours'))`,
        params: [id, storeId, amount, bonusAmount, id, auth.userId, notes, idempotencyKey],
      },
    ])
  } catch (err) {
    if (isUniqueConflict(err)) {
      const dup = await findIdempotentLog(storeId, idempotencyKey, 'balance_logs')
      if (dup) return { id: Number((dup as any).member_id), balance: Number((dup as any).balance_after) }
    }
    throw err
  }

  const after = await queryOne<any>('SELECT id, balance, points FROM members WHERE id = ?', [id])
  notifyInBackground(event, storeId, member.phone, 'balance', {
    amount: delta.toFixed(2),
    balance: Number(after?.balance ?? 0).toFixed(2),
  })

  return after
})
