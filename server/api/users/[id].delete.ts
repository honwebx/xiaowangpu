import { execute, queryOne } from '../../utils/db'
import { requireManagerUp } from '../../utils/auth'
import { invalidateUserVersion } from '../../utils/cache'

export default defineEventHandler(async (event) => {
  const auth = requireManagerUp(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, message: '缺少用户ID' })

  if (id === auth.userId) {
    throw createError({ statusCode: 400, message: '不能删除自己' })
  }

  const target = await queryOne<{ id: number; store_id: number | null; role: string }>(
    'SELECT id, store_id, role FROM users WHERE id = ?',
    [id]
  )
  if (!target) throw createError({ statusCode: 404, message: '用户不存在' })

  if (auth.role !== 'admin') {
    if (target.store_id == null || target.store_id !== auth.storeId) {
      throw createError({ statusCode: 403, message: '无权操作该用户' })
    }
    if (target.role !== 'clerk') {
      throw createError({ statusCode: 403, message: '店长只能管理店员账号' })
    }
  }

  if (target.role === 'admin') {
    const admins = await queryOne<{ c: number }>(
      "SELECT COUNT(*) AS c FROM users WHERE role = 'admin'"
    )
    if (admins && Number(admins.c) <= 1) {
      throw createError({ statusCode: 400, message: '不能删除最后一个管理员' })
    }
  }

  const refs = await queryOne<{ orders: number; stock: number; balance: number; points: number; usage: number }>(
    `SELECT
       (SELECT COUNT(*) FROM orders WHERE operator_id = ?) AS orders,
       (SELECT COUNT(*) FROM product_stock_logs WHERE operator_id = ?) AS stock,
       (SELECT COUNT(*) FROM balance_logs WHERE operator_id = ?) AS balance,
       (SELECT COUNT(*) FROM point_logs WHERE operator_id = ?) AS points,
       (SELECT COUNT(*) FROM count_usage_logs WHERE operator_id = ?) AS usage`,
    [id, id, id, id, id]
  )
  const refTotal = (refs?.orders || 0) + (refs?.stock || 0) + (refs?.balance || 0) + (refs?.points || 0) + (refs?.usage || 0)
  if (refTotal > 0) {
    throw createError({ statusCode: 400, message: '该账号存在历史操作记录，请改用「停用」功能' })
  }

  await execute('DELETE FROM users WHERE id = ?', [id])
  invalidateUserVersion(id)
  return { success: true }
})
