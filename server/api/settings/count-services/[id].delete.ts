import { batch, execute, queryOne } from '../../../utils/db'
import { requirePermission } from '../../../utils/permissions'
import { ensureStoreAccess } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  requirePermission(event, 'count-service.crud')
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, message: '缺少计次项目ID' })

  const svc = await queryOne<any>('SELECT store_id FROM count_services WHERE id = ?', [id])
  if (!svc) throw createError({ statusCode: 404, message: '计次项目不存在' })
  const storeId = Number(svc.store_id)
  ensureStoreAccess(event, storeId)

  const stats = await queryOne<{ total_count: number; active_count: number; active_remaining: number }>(
    `SELECT
       COUNT(*) AS total_count,
       SUM(CASE WHEN remaining_count > 0
                  AND (expires_at IS NULL OR datetime(expires_at) > datetime('now', '+8 hours'))
                 THEN 1 ELSE 0 END) AS active_count,
       COALESCE(SUM(CASE WHEN remaining_count > 0
                          AND (expires_at IS NULL OR datetime(expires_at) > datetime('now', '+8 hours'))
                         THEN remaining_count ELSE 0 END), 0) AS active_remaining
     FROM member_count_services
     WHERE service_id = ? AND store_id = ?`,
    [id, storeId]
  )

  const totalCount = Number(stats?.total_count || 0)
  const activeCount = Number(stats?.active_count || 0)
  const activeRemaining = Number(stats?.active_remaining || 0)

  if (totalCount > 0) {
    await execute(`UPDATE count_services SET status = 'inactive' WHERE id = ? AND store_id = ?`, [id, storeId])
    return {
      success: true,
      inactive: true,
      activeCount,
      activeRemaining,
    }
  }

  const results = await batch([
    {
      sql: `UPDATE order_items SET count_service_id = NULL
            WHERE count_service_id = ?
              AND order_id IN (SELECT id FROM orders WHERE store_id = ?)`,
      params: [id, storeId],
    },
    {
      sql: `DELETE FROM count_usage_logs
            WHERE member_service_id IN (SELECT id FROM member_count_services WHERE service_id = ? AND store_id = ?)`,
      params: [id, storeId],
    },
    {
      sql: `DELETE FROM member_count_services WHERE service_id = ? AND store_id = ?`,
      params: [id, storeId],
    },
    {
      sql: `DELETE FROM count_services WHERE id = ? AND store_id = ?`,
      params: [id, storeId],
    },
  ])

  const finalDelete = results[results.length - 1]
  const changes = Number(finalDelete?.meta?.changes ?? 0)
  if (changes !== 1) {
    throw createError({ statusCode: 500, message: '删除失败，资源不存在或已被删除' })
  }

  return {
    success: true,
    deletedAllocations: totalCount,
    nullifiedOrderItems: Number(results[0]?.meta?.changes ?? 0),
  }
})
