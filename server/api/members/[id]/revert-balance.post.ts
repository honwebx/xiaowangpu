import { execute, queryOne, round2 } from '../../../utils/db'
import { ensureStoreAccess } from '../../../utils/auth'
import { requirePermission } from '../../../utils/permissions'
import { notifyInBackground } from '../../../utils/sms/notify'
import { findIdempotentLog, isUniqueConflict } from '../../../utils/idempotency'

export default defineEventHandler(async (event) => {
  const memberId = Number(getRouterParam(event, 'id'))
  if (!memberId) throw createError({ statusCode: 400, message: '缺少会员ID' })

  const body = await readBody(event)
  const sourceLogId = Number(body?.source_log_id)
  if (!sourceLogId) throw createError({ statusCode: 400, message: '缺少原流水ID' })

  const source = await queryOne<any>('SELECT * FROM balance_logs WHERE id = ?', [sourceLogId])
  if (!source) throw createError({ statusCode: 404, message: '原流水不存在' })
  if (Number(source.member_id) !== memberId) throw createError({ statusCode: 400, message: '流水不属于该会员' })
  ensureStoreAccess(event, Number(source.store_id))

  const auth = requirePermission(event, 'member.revert-balance', {
    targetOperatorId: source.operator_id != null ? Number(source.operator_id) : undefined,
  })

  if (source.source_log_id != null) throw createError({ statusCode: 400, message: '回退流水不可再回退' })
  if (source.type !== 'recharge' && source.type !== 'consume') throw createError({ statusCode: 400, message: '该类型流水不支持回退' })
  if (source.type === 'consume' && source.related_order_id != null) {
    throw createError({ statusCode: 400, message: '订单消费请通过退货流程处理' })
  }

  const amount = round2(Number(body?.amount) || 0)
  const bonus = source.type === 'recharge' ? round2(Number(body?.bonus_amount) || 0) : 0
  if (amount < 0 || bonus < 0) throw createError({ statusCode: 400, message: '回退金额不能为负' })
  if (amount === 0 && bonus === 0) throw createError({ statusCode: 400, message: '请输入回退金额' })

  const reverted = await queryOne<{ amt: number; bon: number }>(
    `SELECT COALESCE(SUM(-amount),0) AS amt, COALESCE(SUM(-bonus_amount),0) AS bon
       FROM balance_logs WHERE source_log_id = ?`,
    [sourceLogId]
  )
  const revertedAmount = round2(Number(reverted?.amt || 0))
  const revertedBonus = round2(Number(reverted?.bon || 0))
  const origAmount = round2(Math.abs(Number(source.amount)))
  const origBonus = round2(Math.abs(Number(source.bonus_amount || 0)))

  if (revertedAmount + amount > origAmount + 0.001) {
    throw createError({ statusCode: 400, message: `回退本金超出原流水（可回退 ¥${round2(origAmount - revertedAmount).toFixed(2)}）` })
  }
  if (revertedBonus + bonus > origBonus + 0.001) {
    throw createError({ statusCode: 400, message: `回退赠金超出原流水（可回退 ¥${round2(origBonus - revertedBonus).toFixed(2)}）` })
  }

  const notes = String(body?.notes || '').trim() || null
  const member = await queryOne<{ balance: number; phone: string }>('SELECT balance, phone FROM members WHERE id = ?', [memberId])
  if (!member) throw createError({ statusCode: 404, message: '会员不存在' })
  const delta = source.type === 'recharge' ? round2(-(amount + bonus)) : amount
  const newBalance = round2(Number(member.balance) + delta)
  if (newBalance < -0.001) {
    throw createError({ statusCode: 400, message: '当前余额不足，无法回退（余额已被消费）' })
  }

  const idempotencyKey = body?.idempotency_key ? String(body.idempotency_key).slice(0, 64) : ''
  if (!idempotencyKey) throw createError({ statusCode: 400, message: '缺少幂等键，请重试' })
  const storeId = Number(source.store_id)
  const existing = await findIdempotentLog(storeId, idempotencyKey, 'balance_logs')
  if (existing) return { balance: Number(existing.balance_after) }

  const updRes = await execute(
    'UPDATE members SET balance = balance + ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND balance + ? >= 0 RETURNING balance',
    [delta, memberId, delta]
  )
  if (!updRes?.meta?.changes) {
    throw createError({ statusCode: 400, message: '当前余额不足，无法回退（余额已被消费）' })
  }
  const realBalance = Number(updRes?.results?.[0]?.balance ?? newBalance)
  try {
    await execute(
      `INSERT INTO balance_logs (member_id, store_id, type, amount, bonus_amount, balance_after, source_log_id, operator_id, notes, idempotency_key, created_at)
       VALUES (?, ?, 'refund', ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))`,
      [memberId, storeId, -amount, -bonus, realBalance, sourceLogId, auth.userId, notes, idempotencyKey]
    )
  } catch (err) {
    if (isUniqueConflict(err)) {
      const existing = await findIdempotentLog(storeId, idempotencyKey, 'balance_logs')
      if (existing) return { balance: Number(existing.balance_after) }
    }
    await execute('UPDATE members SET balance = balance - ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ?', [delta, memberId]).catch(() => {})
    throw err
  }

  notifyInBackground(event, storeId, member.phone, 'balance', {
    amount: Math.abs(delta).toFixed(2),
    balance: realBalance.toFixed(2),
  })

  return { balance: realBalance }
})
