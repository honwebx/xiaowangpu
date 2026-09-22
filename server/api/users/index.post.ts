import { execute, queryOne } from '../../utils/db'
import { requireManagerUp } from '../../utils/auth'
import { hashPassword } from '../../utils/crypto'

export default defineEventHandler(async (event) => {
  const auth = requireManagerUp(event)
  const body = await readBody(event)
  const name = String(body?.name || '').trim()
  const phone = String(body?.phone || '').trim()
  const password = String(body?.password || '')
  const role = String(body?.role || 'clerk')

  if (!name) throw createError({ statusCode: 400, message: '请填写姓名' })
  if (!/^1\d{10}$/.test(phone)) throw createError({ statusCode: 400, message: '手机号格式不正确' })
  if (!password) throw createError({ statusCode: 400, message: '请填写密码' })
  if (password.length < 6) throw createError({ statusCode: 400, message: '密码至少6位' })
  if (!['admin', 'manager', 'clerk'].includes(role)) {
    throw createError({ statusCode: 400, message: '角色无效' })
  }
  if (auth.role !== 'admin' && role !== 'clerk') {
    throw createError({ statusCode: 403, message: '店长只能创建店员账号' })
  }

  let storeId: number | null
  if (role === 'admin') {
    if (auth.role !== 'admin') {
      throw createError({ statusCode: 403, message: '无权创建管理员' })
    }
    storeId = null
  } else if (auth.role === 'admin') {
    if (body?.storeId == null || body.storeId === '') {
      throw createError({ statusCode: 400, message: '请选择店铺' })
    }
    storeId = Number(body.storeId)
  } else {
    storeId = auth.storeId
    if (storeId == null) {
      throw createError({ statusCode: 403, message: '账号未绑定店铺，请联系管理员' })
    }
  }

  if (storeId != null) {
    const s = await queryOne<{ id: number }>('SELECT id FROM stores WHERE id = ?', [storeId])
    if (!s) throw createError({ statusCode: 400, message: '店铺不存在' })
  }

  if (storeId == null) {
    const adminDup = await queryOne<{ id: number }>(
      'SELECT id FROM users WHERE store_id IS NULL AND phone = ?',
      [phone]
    )
    if (adminDup) throw createError({ statusCode: 400, message: '该手机号已存在管理员账号' })
  } else {
    const storeDup = await queryOne<{ id: number }>(
      'SELECT id FROM users WHERE store_id = ? AND phone = ?',
      [storeId, phone]
    )
    if (storeDup) throw createError({ statusCode: 400, message: '该手机号在本店铺已被使用' })
  }

  const passwordHash = await hashPassword(password)
  const res = await execute(
    'INSERT INTO users (store_id, name, phone, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\', \'+8 hours\'))',
    [storeId, name, phone, passwordHash, role]
  )
  const userId = res?.meta?.last_row_id
  if (!userId) throw createError({ statusCode: 500, message: '创建用户失败' })

  let store: { id: number; name: string } | null = null
  if (storeId != null) {
    const st = await queryOne<{ id: number; name: string }>(
      'SELECT id, name FROM stores WHERE id = ?',
      [storeId]
    )
    if (st) store = { id: st.id, name: st.name }
  }

  return { id: userId, store_id: storeId, name, phone, role, status: 'active', store }
})
