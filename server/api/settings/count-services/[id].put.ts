import { execute, queryOne } from '../../../utils/db'
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

  const body = await readBody(event)
  const fields: string[] = []
  const params: any[] = []
  if (body?.name !== undefined) {
    const name = String(body.name).trim()
    if (!name) throw createError({ statusCode: 400, message: '名称不能为空' })
    fields.push('name = ?'); params.push(name)
  }
  if (body?.total_count !== undefined) {
    const tc = Math.floor(Number(body.total_count))
    if (!Number.isFinite(tc) || tc <= 0) throw createError({ statusCode: 400, message: '总次数必须大于0' })
    fields.push('total_count = ?'); params.push(tc)
  }
  if (body?.price !== undefined) {
    const p = Number(body.price)
    if (!Number.isFinite(p) || p < 0) throw createError({ statusCode: 400, message: '价格无效' })
    fields.push('price = ?'); params.push(p)
  }
  if (body?.validity_months !== undefined) {
    const vm = body.validity_months != null ? Number(body.validity_months) : null
    if (vm != null && (!Number.isFinite(vm) || vm <= 0)) {
      throw createError({ statusCode: 400, message: '有效期月数无效' })
    }
    fields.push('validity_months = ?'); params.push(vm)
  }
  if (body?.status !== undefined) {
    const st = String(body.status)
    if (st !== 'active' && st !== 'inactive') throw createError({ statusCode: 400, message: '状态无效' })
    fields.push('status = ?'); params.push(st)
  }

  if (fields.length === 0) {
    return await queryOne('SELECT * FROM count_services WHERE id = ? AND store_id = ?', [id, storeId])
  }
  params.push(id, storeId)
  await execute(`UPDATE count_services SET ${fields.join(', ')} WHERE id = ? AND store_id = ?`, params)
  return await queryOne('SELECT * FROM count_services WHERE id = ? AND store_id = ?', [id, storeId])
})
