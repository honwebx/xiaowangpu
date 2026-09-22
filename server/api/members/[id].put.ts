import { execute, queryOne } from '../../utils/db'
import { ensureStoreAccess } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, message: '缺少会员ID' })

  const member = await queryOne<any>('SELECT store_id FROM members WHERE id = ?', [id])
  if (!member) throw createError({ statusCode: 404, message: '会员不存在' })
  ensureStoreAccess(event, Number(member.store_id))

  const body = await readBody(event)
  const fields: string[] = []
  const params: any[] = []

  if (body?.name !== undefined) {
    const name = String(body.name).trim()
    if (!name) throw createError({ statusCode: 400, message: '姓名不能为空' })
    fields.push('name = ?'); params.push(name)
  }
  if (body?.phone !== undefined) {
    const phone = String(body.phone).trim()
    if (!phone) throw createError({ statusCode: 400, message: '手机号不能为空' })
    if (!/^1[3-9]\d{9}$/.test(phone)) throw createError({ statusCode: 400, message: '手机号格式不正确' })
    const dup = await queryOne('SELECT id FROM members WHERE store_id = ? AND phone = ? AND id != ?', [member.store_id, phone, id])
    if (dup) throw createError({ statusCode: 400, message: '该手机号已是会员' })
    fields.push('phone = ?'); params.push(phone)
  }
  if (body?.birthday !== undefined) { fields.push('birthday = ?'); params.push(body.birthday || null) }
  if (body?.level !== undefined) {
    const level = body.level === 'vip' ? 'vip' : 'normal'
    fields.push('level = ?'); params.push(level)
  }
  if (body?.notes !== undefined) { fields.push('notes = ?'); params.push(body.notes || null) }

  if (fields.length === 0) return await queryOne('SELECT * FROM members WHERE id = ?', [id])
  fields.push("updated_at = datetime('now', '+8 hours')")
  params.push(id)
  await execute(`UPDATE members SET ${fields.join(', ')} WHERE id = ?`, params)
  return await queryOne('SELECT * FROM members WHERE id = ?', [id])
})
