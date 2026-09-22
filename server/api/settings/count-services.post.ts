import { execute, queryOne } from '../../utils/db'
import { ensureStoreAccess } from '../../utils/auth'
import { requirePermission } from '../../utils/permissions'

export default defineEventHandler(async (event) => {
  requirePermission(event, 'count-service.crud')
  const body = await readBody(event)
  const storeId = Number(body?.store_id)
  if (!storeId) throw createError({ statusCode: 400, message: '缺少店铺' })
  ensureStoreAccess(event, storeId)

  const name = String(body?.name || '').trim()
  if (!name) throw createError({ statusCode: 400, message: '请填写服务名称' })
  const totalCount = Math.floor(Number(body?.total_count))
  if (!totalCount || totalCount <= 0) throw createError({ statusCode: 400, message: '总次数必须大于0' })
  const price = Number(body?.price)
  if (!Number.isFinite(price) || price < 0) throw createError({ statusCode: 400, message: '价格无效' })

  const validityMonths = body?.validity_months != null && body?.validity_months !== '' ? Number(body.validity_months) : null
  if (validityMonths != null && (!Number.isInteger(validityMonths) || validityMonths <= 0)) {
    throw createError({ statusCode: 400, message: '有效期月数无效' })
  }

  const res = await execute(
    `INSERT INTO count_services (store_id, name, total_count, price, validity_months, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '+8 hours'))`,
    [storeId, name, totalCount, price, validityMonths]
  )
  const id = res?.meta?.last_row_id
  if (!id) throw createError({ statusCode: 500, message: '创建计次项目失败' })
  return await queryOne('SELECT * FROM count_services WHERE id = ?', [id])
})
