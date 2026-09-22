import { execute, queryOne, round2 } from '../../../utils/db'
import { ensureStoreAccess } from '../../../utils/auth'
import { requirePermission } from '../../../utils/permissions'
import { notifyInBackground } from '../../../utils/sms/notify'
import { findIdempotentLog, isUniqueConflict } from '../../../utils/idempotency'

export default defineEventHandler(async (event) => {
  const auth = requirePermission(event, 'member.consume')
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, message: '缺少会员ID' })

  const member = await queryOne<any>('SELECT * FROM members WHERE id = ?', [id])
  if (!member) throw createError({ statusCode: 404, message: '会员不存在' })
  ensureStoreAccess(event, Number(member.store_id))

  const body = await readBody(event)
  const amount = round2(Number(body?.amount) || 0)
  if (amount <= 0) throw createError({ statusCode: 400, message: '消费金额必须大于0' })
  if (amount > Number(member.balance)) {
    throw createError({ statusCode: 400, message: '余额不足' })
  }

  const notes = String(body?.notes || '').trim() || null
  const idempotencyKey = body?.idempotency_key ? String(body.idempotency_key).slice(0, 64) : ''
  if (!idempotencyKey) throw createError({ statusCode: 400, message: '缺少幂等键，请重试' })
  const storeId = Number(member.store_id)
  const existing = await findIdempotentLog(storeId, idempotencyKey, 'balance_logs')
  if (existing) return { balance: Number(existing.balance_after) }

  const updRes = await execute(
    'UPDATE members SET balance = balance - ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND balance >= ? RETURNING balance',
    [amount, id, amount]
  )
  if (!updRes?.meta?.changes) {
    throw createError({ statusCode: 400, message: '余额不足' })
  }
  const newBalance = Number(updRes?.results?.[0]?.balance ?? 0)
  try {
    await execute(
      `INSERT INTO balance_logs (member_id, store_id, type, amount, balance_after, operator_id, notes, idempotency_key, created_at)
       VALUES (?, ?, 'consume', ?, ?, ?, ?, ?, datetime('now', '+8 hours'))`,
      [id, storeId, amount, newBalance, auth.userId, notes, idempotencyKey]
    )
  } catch (err) {
    if (isUniqueConflict(err)) {
      const dup = await findIdempotentLog(storeId, idempotencyKey, 'balance_logs')
      if (dup) return { balance: Number(dup.balance_after) }
    }
    await execute('UPDATE members SET balance = balance + ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ?', [amount, id]).catch(() => {})
    throw err
  }

  notifyInBackground(event, storeId, member.phone, 'balance', {
    amount: amount.toFixed(2),
    balance: newBalance.toFixed(2),
  })

  return { balance: newBalance }
})
