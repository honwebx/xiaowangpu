import { execute, queryOne } from '../../utils/db'
import { isUniqueConflict } from '../../utils/idempotency'
import { requireAdmin } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const body = await readBody(event)
  const name = String(body?.name || '').trim()
  if (!name) throw createError({ statusCode: 400, message: '请填写店铺名称' })
  if (name.length > 64) throw createError({ statusCode: 400, message: '店铺名称过长，最多64个字符' })

  const address = body?.address != null && String(body.address).trim() !== '' ? String(body.address).trim() : null
  const phone = body?.phone != null && String(body.phone).trim() !== '' ? String(body.phone).trim() : null
  if (address != null && address.length > 128) throw createError({ statusCode: 400, message: '地址过长，最多128个字符' })
  if (phone != null && phone.length > 32) throw createError({ statusCode: 400, message: '电话过长，最多32个字符' })

  const dup = await queryOne<{ id: number }>('SELECT id FROM stores WHERE name = ? COLLATE NOCASE', [name])
  if (dup) throw createError({ statusCode: 400, message: '店铺名称已存在' })

  let storeId = 0
  try {
    const res = await execute(
      'INSERT INTO stores (name, address, phone, created_at) VALUES (?, ?, ?, datetime(\'now\', \'+8 hours\'))',
      [name, address, phone]
    )
    storeId = Number(res?.meta?.last_row_id)
    if (!storeId) throw createError({ statusCode: 500, message: '创建店铺失败' })
  } catch (err: any) {
    if (err?.statusCode) throw err
    if (isUniqueConflict(err)) throw createError({ statusCode: 400, message: '店铺名称已存在' })
    throw err
  }

  try {
    await execute(
      `INSERT INTO settings (store_id) VALUES (?)
       ON CONFLICT(store_id) DO NOTHING`,
      [storeId]
    )
  } catch (err: any) {
    await execute('DELETE FROM stores WHERE id = ?', [storeId]).catch(() => {})
    throw createError({ statusCode: 500, message: '店铺设置初始化失败: ' + (err?.message || '未知错误') })
  }

  const store = await queryOne('SELECT id, name, address, phone, created_at FROM stores WHERE id = ?', [storeId])
  return store
})
