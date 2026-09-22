import { execute, queryOne } from '../../../utils/db'
import { requirePermission } from '../../../utils/permissions'
import { ensureStoreAccess } from '../../../utils/auth'
import { notifyInBackground } from '../../../utils/sms/notify'
import { findIdempotentLog, isUniqueConflict } from '../../../utils/idempotency'

export default defineEventHandler(async (event) => {
  const memberId = Number(getRouterParam(event, 'id'))
  if (!memberId) throw createError({ statusCode: 400, message: '缺少会员ID' })

  const body = await readBody(event)
  const logId = Number(body?.log_id)
  if (!logId) throw createError({ statusCode: 400, message: '缺少记录ID' })

  const log = await queryOne<any>('SELECT * FROM count_usage_logs WHERE id = ?', [logId])
  if (!log) throw createError({ statusCode: 404, message: '扣次记录不存在' })
  if (Number(log.deduction_count) <= 0) {
    throw createError({ statusCode: 400, message: '只能回退扣次记录' })
  }

  const mcs = await queryOne<any>(
    `SELECT mcs.*, cs.total_count AS total_count FROM member_count_services mcs
      LEFT JOIN count_services cs ON cs.id = mcs.service_id WHERE mcs.id = ?`,
    [(log as any).member_service_id]
  )
  if (!mcs) throw createError({ statusCode: 404, message: '计次项目不存在' })

  ensureStoreAccess(event, Number(mcs.store_id))
  if (Number(log.store_id) !== Number(mcs.store_id)) throw createError({ statusCode: 400, message: '记录不属于该店铺' })
  if (mcs.member_id !== memberId) throw createError({ statusCode: 400, message: '记录不属于该会员' })

  const auth = requirePermission(event, 'member.revert-deduct', {
    targetOperatorId: log.operator_id != null ? Number(log.operator_id) : undefined,
  })

  const idempotencyKey = body?.idempotency_key ? String(body.idempotency_key).slice(0, 64) : ''
  if (!idempotencyKey) throw createError({ statusCode: 400, message: '缺少幂等键，请重试' })
  const storeId = Number(mcs.store_id)
  const existing = await findIdempotentLog(storeId, idempotencyKey, 'count_usage_logs')
  if (existing) {
    const cur = await queryOne<{ remaining_count: number }>('SELECT remaining_count FROM member_count_services WHERE id = ?', [mcs.id])
    return { remaining_count: Number(cur?.remaining_count ?? 0) }
  }

  const totalCount = Number((mcs as any).total_count) || 0
  if (totalCount > 0 && Number(mcs.remaining_count) + Number(log.deduction_count) > totalCount) {
    throw createError({ statusCode: 400, message: '回退次数超出购买总数' })
  }

  const newRemaining = Number(mcs.remaining_count) + Number(log.deduction_count)

  // 原子防双回退：依赖 idx_count_usage_logs_revert_marker 唯一索引
  // 第一次 INSERT 成功，第二次 ON CONFLICT 触发 meta.changes=0
  let insRes: any
  try {
    insRes = await execute(
      `INSERT INTO count_usage_logs (member_service_id, store_id, deduction_count, unit_amount, remaining_after, related_order_id, operator_id, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))
       ON CONFLICT(member_service_id, related_order_id) DO NOTHING`,
      [mcs.id, Number(mcs.store_id), -log.deduction_count, log.unit_amount ? -log.unit_amount : 0, newRemaining, logId, auth.userId, idempotencyKey],
    )
  } catch (err) {
    if (isUniqueConflict(err)) {
      const dup = await findIdempotentLog(storeId, idempotencyKey, 'count_usage_logs')
      if (dup) {
        const cur = await queryOne<{ remaining_count: number }>('SELECT remaining_count FROM member_count_services WHERE id = ?', [mcs.id])
        return { remaining_count: Number(cur?.remaining_count ?? 0) }
      }
    }
    throw err
  }
  const inserted = Number(insRes?.meta?.changes ?? 0)
  if (!inserted) {
    throw createError({ statusCode: 400, message: '该记录已回退' })
  }

  await execute(
    'UPDATE member_count_services SET remaining_count = remaining_count + ? WHERE id = ?',
    [log.deduction_count, mcs.id],
  )

  const real = await queryOne<{ remaining_count: number }>('SELECT remaining_count FROM member_count_services WHERE id = ?', [mcs.id])
  const realRemaining = Number(real?.remaining_count ?? newRemaining)

  const member = await queryOne<{ phone: string }>('SELECT phone FROM members WHERE id = ?', [memberId])
  notifyInBackground(event, Number(mcs.store_id), member?.phone, 'count', {
    count: String(log.deduction_count),
    remaining: String(realRemaining),
  })

  return { remaining_count: realRemaining }
})
