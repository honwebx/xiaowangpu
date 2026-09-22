import { execute, queryOne } from '../../utils/db'
import { requireManagerUp } from '../../utils/auth'
import { hashPassword } from '../../utils/crypto'
import { invalidateUserVersion } from '../../utils/cache'

export default defineEventHandler(async (event) => {
  const auth = requireManagerUp(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, message: '缺少用户ID' })

  const target = await queryOne<{ id: number; store_id: number | null; role: string; status: string }>(
    'SELECT id, store_id, role, status FROM users WHERE id = ?',
    [id]
  )
  if (!target) throw createError({ statusCode: 404, message: '用户不存在' })

  const isSelf = id === auth.userId

  if (!isSelf && auth.role !== 'admin') {
    if (target.store_id == null || target.store_id !== auth.storeId) {
      throw createError({ statusCode: 403, message: '无权操作该用户' })
    }
    if (target.role !== 'clerk') {
      throw createError({ statusCode: 403, message: '店长只能管理店员账号' })
    }
  }

  const body = await readBody(event)
  const fields: string[] = []
  const params: any[] = []
  let sensitiveChanged = false

  // 同时改 phone+storeId 时，去重以目标店铺为准
  let effectiveStoreId: number | null | undefined = target.store_id
  if (body?.storeId !== undefined) {
    effectiveStoreId = body.storeId !== null && body.storeId !== '' ? Number(body.storeId) : null
  }

  if (body?.name !== undefined) {
    const name = String(body.name).trim()
    if (!name) throw createError({ statusCode: 400, message: '姓名不能为空' })
    fields.push('name = ?'); params.push(name)
  }
  if (body?.phone !== undefined) {
    const phone = String(body.phone).trim()
    if (!/^1\d{10}$/.test(phone)) throw createError({ statusCode: 400, message: '手机号格式不正确' })
    const dup =
      effectiveStoreId == null
        ? await queryOne<{ id: number }>(
            'SELECT id FROM users WHERE store_id IS NULL AND phone = ? AND id != ?',
            [phone, id]
          )
        : await queryOne<{ id: number }>(
            'SELECT id FROM users WHERE store_id = ? AND phone = ? AND id != ?',
            [effectiveStoreId, phone, id]
          )
    if (dup) throw createError({ statusCode: 400, message: '手机号已被使用' })
    fields.push('phone = ?'); params.push(phone)
  }
  if (body?.role !== undefined) {
    const role = String(body.role)
    if (!['admin', 'manager', 'clerk'].includes(role)) throw createError({ statusCode: 400, message: '角色无效' })
    if (role === target.role) {
    } else {
      if (auth.role !== 'admin' && role === 'admin') {
        throw createError({ statusCode: 403, message: '无权设置管理员' })
      }
      if (auth.role !== 'admin' && role !== 'clerk') {
        throw createError({ statusCode: 403, message: '店长只能管理店员账号' })
      }
      if (isSelf) {
        throw createError({ statusCode: 400, message: '不能修改自己的角色' })
      }
      if (target.role === 'admin' && role !== 'admin') {
        const adminCount = await queryOne<{ c: number }>(
          "SELECT COUNT(*) AS c FROM users WHERE role = 'admin'",
        )
        if (adminCount && Number(adminCount.c) <= 1) {
          throw createError({ statusCode: 400, message: '不能降级唯一管理员，请先创建其他管理员' })
        }
      }
      if (role !== 'admin' && target.store_id == null && body?.storeId == null) {
        throw createError({ statusCode: 400, message: '店长和店员必须绑定店铺' })
      }
      fields.push('role = ?'); params.push(role)
      sensitiveChanged = true
    }
  }
  if (body?.storeId !== undefined) {
    let storeId: number | null = null
    if (body.storeId !== null && body.storeId !== '') {
      storeId = Number(body.storeId)
    }
    const unchanged = storeId == null ? target.store_id == null : target.store_id === storeId
    if (!unchanged) {
      if (auth.role !== 'admin') {
        throw createError({ statusCode: 403, message: '无权修改所属店铺' })
      }
      if (isSelf) {
        throw createError({ statusCode: 400, message: '不能修改自己的所属店铺' })
      }
      if (storeId !== null) {
        const s = await queryOne<{ id: number }>('SELECT id FROM stores WHERE id = ?', [storeId])
        if (!s) throw createError({ statusCode: 400, message: '店铺不存在' })
      }
      fields.push('store_id = ?'); params.push(storeId)
      sensitiveChanged = true
    }
  }
  if (body?.password !== undefined && body.password) {
    if (String(body.password).length < 6) throw createError({ statusCode: 400, message: '密码至少6位' })
    const passwordHash = await hashPassword(String(body.password))
    fields.push('password_hash = ?'); params.push(passwordHash)
    sensitiveChanged = true
  }
  if (body?.status !== undefined) {
    const status = String(body.status)
    if (!['active', 'inactive'].includes(status)) {
      throw createError({ statusCode: 400, message: '状态值无效' })
    }
    if (status === target.status) {
    } else {
      if (!isSelf && auth.role !== 'admin' && target.role !== 'clerk') {
        throw createError({ statusCode: 403, message: '店长只能管理店员账号' })
      }
      if (isSelf) {
        throw createError({ statusCode: 400, message: '不能修改自己的账号状态' })
      }
      if (status === 'inactive' && target.role === 'admin') {
        const adminCount = await queryOne<{ c: number }>(
          "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'active'",
        )
        if (adminCount && Number(adminCount.c) <= 1) {
          throw createError({ statusCode: 400, message: '不能停用唯一的管理员' })
        }
      }
      fields.push('status = ?'); params.push(status)
      sensitiveChanged = true
    }
  }

  if (fields.length > 0) {
    if (sensitiveChanged) {
      fields.push('token_version = token_version + 1')
    }
    params.push(id)
    await execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params)
    // 敏感字段变更后让旧 token 立即失效
    invalidateUserVersion(id)
  }

  const user = await queryOne<{ id: number; store_id: number | null; name: string; phone: string; role: string; status: string; created_at: string }>(
    'SELECT id, store_id, name, phone, role, status, created_at FROM users WHERE id = ?',
    [id]
  )

  let store: { id: number; name: string } | null = null
  if (user && user.store_id != null) {
    const st = await queryOne<{ id: number; name: string }>(
      'SELECT id, name FROM stores WHERE id = ?',
      [user.store_id]
    )
    if (st) store = { id: st.id, name: st.name }
  }

  return { ...user, store }
})