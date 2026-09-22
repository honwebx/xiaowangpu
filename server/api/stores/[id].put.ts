import { execute, queryOne } from '../../utils/db'
import { isUniqueConflict } from '../../utils/idempotency'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, message: '缺少店铺ID' })

  const body = await readBody(event)
  const fields: string[] = []
  const params: any[] = []

  if (body?.name !== undefined) {
    const name = String(body.name).trim()
    if (!name) throw createError({ statusCode: 400, message: '店铺名称不能为空' })
    if (name.length > 64) throw createError({ statusCode: 400, message: '店铺名称过长，最多64个字符' })
    const dup = await queryOne<{ id: number }>(
      'SELECT id FROM stores WHERE name = ? COLLATE NOCASE AND id != ?',
      [name, id]
    )
    if (dup) throw createError({ statusCode: 400, message: '店铺名称已存在' })
    fields.push('name = ?')
    params.push(name)
  }
  if (body?.address !== undefined) {
    const address = body.address != null && String(body.address).trim() !== '' ? String(body.address).trim() : null
    if (address != null && address.length > 128) throw createError({ statusCode: 400, message: '地址过长，最多128个字符' })
    fields.push('address = ?')
    params.push(address)
  }
  if (body?.phone !== undefined) {
    const phone = body.phone != null && String(body.phone).trim() !== '' ? String(body.phone).trim() : null
    if (phone != null && phone.length > 32) throw createError({ statusCode: 400, message: '电话过长，最多32个字符' })
    fields.push('phone = ?')
    params.push(phone)
  }

  if (fields.length === 0) {
    const store = await queryOne('SELECT id, name, address, phone, created_at FROM stores WHERE id = ?', [id])
    if (!store) throw createError({ statusCode: 404, message: '店铺不存在' })
    return store
  }

  params.push(id)
  let res: any
  try {
    res = await execute(`UPDATE stores SET ${fields.join(', ')} WHERE id = ?`, params)
  } catch (err: any) {
    if (isUniqueConflict(err)) throw createError({ statusCode: 400, message: '店铺名称已存在' })
    throw err
  }
  if (!res?.meta?.changes) {
    const exists = await queryOne('SELECT id FROM stores WHERE id = ?', [id])
    if (!exists) throw createError({ statusCode: 404, message: '店铺不存在' })
  }
  return await queryOne('SELECT id, name, address, phone, created_at FROM stores WHERE id = ?', [id])
})
