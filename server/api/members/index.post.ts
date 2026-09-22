import { execute, queryOne } from '../../utils/db'
import { ensureStoreAccess } from '../../utils/auth'
import { isUniqueConflict } from '../../utils/idempotency'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const storeId = Number(body?.store_id)
  if (!storeId) throw createError({ statusCode: 400, message: '缺少店铺' })
  ensureStoreAccess(event, storeId)

  const name = String(body?.name || '').trim()
  if (!name) throw createError({ statusCode: 400, message: '请填写会员姓名' })
  const phone = String(body?.phone || '').trim()
  if (!phone) throw createError({ statusCode: 400, message: '请填写手机号' })
  if (!/^1[3-9]\d{9}$/.test(phone)) throw createError({ statusCode: 400, message: '手机号格式不正确' })

  const dup = await queryOne('SELECT id FROM members WHERE store_id = ? AND phone = ?', [storeId, phone])
  if (dup) throw createError({ statusCode: 400, message: '该手机号已是会员' })

  const level = body?.level === 'vip' ? 'vip' : 'normal'
  let res: any
  try {
    res = await execute(
      `INSERT INTO members (store_id, name, phone, birthday, level, balance, points, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))`,
      [storeId, name, phone, body?.birthday || null, level, body?.notes || null]
    )
  } catch (err) {
    if (isUniqueConflict(err)) throw createError({ statusCode: 400, message: '该手机号已是会员' })
    throw err
  }
  const id = res?.meta?.last_row_id
  if (!id) throw createError({ statusCode: 500, message: '创建会员失败' })
  return await queryOne('SELECT * FROM members WHERE id = ?', [id])
})
