import { batch, query, queryOne } from '../../utils/db'
import { ensureStoreAccess, requireManagerUp } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  requireManagerUp(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, message: '缺少会员ID' })

  const member = await queryOne<any>('SELECT store_id, balance, points FROM members WHERE id = ?', [id])
  if (!member) throw createError({ statusCode: 404, message: '会员不存在' })
  ensureStoreAccess(event, Number(member.store_id))

  const orders = await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM orders WHERE member_id = ?', [id])
  if (orders && Number(orders.c) > 0) {
    throw createError({ statusCode: 400, message: '该会员存在订单，无法删除' })
  }

  if (Number(member.balance) > 0) {
    throw createError({ statusCode: 400, message: `会员余额还有 ¥${member.balance}，请先清零后再删除` })
  }
  if (Number(member.points) > 0) {
    throw createError({ statusCode: 400, message: `会员还有 ${member.points} 积分，请先清零后再删除` })
  }

  const remain = await queryOne<{ c: number }>('SELECT COALESCE(SUM(remaining_count), 0) AS c FROM member_count_services WHERE member_id = ?', [id])
  if (remain && Number(remain.c) > 0) {
    throw createError({ statusCode: 400, message: `会员还有 ${remain.c} 次计次项目未用完，无法删除` })
  }

  await batch([
    { sql: 'DELETE FROM count_usage_logs WHERE member_service_id IN (SELECT id FROM member_count_services WHERE member_id = ?)', params: [id] },
    { sql: 'DELETE FROM member_count_services WHERE member_id = ?', params: [id] },
    { sql: 'DELETE FROM balance_logs WHERE member_id = ?', params: [id] },
    { sql: 'DELETE FROM point_logs WHERE member_id = ?', params: [id] },
    { sql: 'DELETE FROM members WHERE id = ?', params: [id] },
  ])
  return { success: true }
})
