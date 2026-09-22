import { batch, execute, queryOne } from '../utils/db'
import { hashPassword } from '../utils/crypto'
import { checkLoginAllowed, recordLoginFailure, resetLoginThrottle, throttleKey, clientIp } from '../utils/loginThrottle'

function strOrEmpty(v: any): string {
  if (v == null) return ''
  return String(v).trim()
}

const MAX_PASSWORD_LEN = 128

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const admin = body?.admin || {}
  const store = body?.store || {}

  const adminName = strOrEmpty(admin.name)
  const adminPhone = strOrEmpty(admin.phone)
  const adminPassword = strOrEmpty(admin.password)
  const storeName = strOrEmpty(store.name)
  const storeAddress = strOrEmpty(store.address) || null
  const storePhone = strOrEmpty(store.phone) || null

  if (!adminName) throw createError({ statusCode: 400, message: '请填写管理员姓名' })
  if (adminName.length > 50) throw createError({ statusCode: 400, message: '管理员姓名过长' })
  if (!/^1\d{10}$/.test(adminPhone)) throw createError({ statusCode: 400, message: '管理员手机号格式不正确' })
  if (!adminPassword || adminPassword.length < 6) throw createError({ statusCode: 400, message: '密码至少6位' })
  if (adminPassword.length > MAX_PASSWORD_LEN) throw createError({ statusCode: 400, message: '密码过长，最多128位' })
  if (!storeName) throw createError({ statusCode: 400, message: '请填写店铺名称' })
  if (storeName.length > 50) throw createError({ statusCode: 400, message: '店铺名称过长' })
  if (storeAddress && storeAddress.length > 200) throw createError({ statusCode: 400, message: '店铺地址过长' })
  if (storePhone && storePhone.length > 50) throw createError({ statusCode: 400, message: '店铺电话过长' })

  const key = throttleKey(clientIp(event), 'setup', null)
  await checkLoginAllowed(key)

  const existing = await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM users')
  if (existing && Number(existing.c) > 0) {
    await recordLoginFailure(key)
    throw createError({ statusCode: 403, message: '系统已初始化，请直接登录' })
  }

  // 初始化一生一次：COUNT 检查与写入不在同一事务，并发双调同时通过检查时由 setup_lock 主键冲突裁决，只有一个能抢到锁
  try {
    await execute('INSERT INTO setup_lock (id) VALUES (1)')
  } catch {
    await recordLoginFailure(key)
    throw createError({ statusCode: 403, message: '系统已初始化，请直接登录' })
  }

  let storeId = 0
  let userId = 0
  let createdStore = false
  let createdSettings = false
  try {
    const orphan = await queryOne<{ id: number }>('SELECT id FROM stores ORDER BY id LIMIT 1')
    if (orphan) {
      storeId = Number(orphan.id)
    } else {
      let storeRes
      try {
        storeRes = await execute(
          'INSERT INTO stores (name, address, phone, created_at) VALUES (?, ?, ?, datetime(\'now\', \'+8 hours\'))',
          [storeName, storeAddress, storePhone]
        )
      } catch (err: any) {
        throw new Error(/UNIQUE/i.test(err?.message || '') ? '店铺名称已存在，请更换后重试' : '店铺创建失败')
      }
      storeId = Number(storeRes?.meta?.last_row_id)
      if (!storeId) throw new Error('店铺创建失败')
      createdStore = true
    }

    const passwordHash = await hashPassword(adminPassword)
    let userRes
    try {
      userRes = await execute(
        'INSERT INTO users (store_id, name, phone, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\', \'+8 hours\'))',
        [null, adminName, adminPhone, passwordHash, 'admin']
      )
    } catch (err: any) {
      throw new Error(/UNIQUE/i.test(err?.message || '') ? '该手机号已初始化，请直接登录' : '管理员创建失败')
    }
    userId = Number(userRes?.meta?.last_row_id)
    if (!userId) throw new Error('管理员创建失败')

    const settingsRes = await execute(
      `INSERT OR IGNORE INTO settings (store_id, points_earn_rate, points_redeem_amount, points_redeem_value,
        balance_payment_enabled, points_payment_enabled, default_stock_alert)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [storeId, 1, 100, 1, 1, 1, 10]
    )
    createdSettings = Number(settingsRes?.meta?.changes) > 0

    await resetLoginThrottle(key)
  } catch (err: any) {
    // 失败回滚：D1 batch 原子，补偿语句一起跑；释放 setup_lock 以允许重试
    await batch([
      ...(createdSettings ? [{ sql: 'DELETE FROM settings WHERE store_id = ?', params: [storeId] }] : []),
      { sql: 'DELETE FROM users WHERE id = ?', params: [userId] },
      ...(createdStore ? [{ sql: 'DELETE FROM stores WHERE id = ?', params: [storeId] }] : []),
      { sql: 'DELETE FROM setup_lock WHERE id = 1' },
    ]).catch(() => {})
    await recordLoginFailure(key)
    if (err?.statusCode) throw err
    throw createError({ statusCode: 500, message: '初始化失败: ' + (err?.message || '未知错误') })
  }

  return { success: true, storeId, userId }
})
