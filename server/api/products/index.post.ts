import { batch, query, queryOne } from '../../utils/db'
import { requireManagerUp, ensureStoreAccess } from '../../utils/auth'
import { pinyinInitials } from '../../utils/shortcode'
import { prefixLike } from '../../utils/like'
import { isUniqueConflict } from '../../utils/idempotency'

function toNonNegNumber(v: any, field: string): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) {
    throw createError({ statusCode: 400, message: `${field}必须为非负数字` })
  }
  return n
}

function toNullableNonNegNumber(v: any, field: string): number | null {
  if (v == null || v === '') return null
  return toNonNegNumber(v, field)
}

export default defineEventHandler(async (event) => {
  const auth = requireManagerUp(event)
  const body = await readBody(event)
  const storeId = Number(body?.store_id)
  if (!storeId) throw createError({ statusCode: 400, message: '缺少店铺' })
  ensureStoreAccess(event, storeId)

  const name = String(body?.name || '').trim()
  if (!name) throw createError({ statusCode: 400, message: '请填写商品名称' })
  const primaryUnit = String(body?.primary_unit || '').trim()
  if (!primaryUnit) throw createError({ statusCode: 400, message: '请填写主单位' })
  const sellingPrice = toNonNegNumber(body?.selling_price, '售价')
  const costPrice = toNullableNonNegNumber(body?.cost_price, '成本价')
  const conversionRate = toNullableNonNegNumber(body?.conversion_rate, '换算比例')
  if (conversionRate === 0) throw createError({ statusCode: 400, message: '换算比例不能为0' })
  const secondaryPrice = toNullableNonNegNumber(body?.secondary_price, '副单位售价')
  const stockAlert = body?.stock_alert != null && body?.stock_alert !== ''
    ? toNonNegNumber(body.stock_alert, '库存预警')
    : 10
  const secondaryUnit = String(body?.secondary_unit || '').trim() || null
  if (secondaryUnit && conversionRate == null) {
    throw createError({ statusCode: 400, message: '填写副单位时换算比例必填' })
  }
  const status = String(body?.status || 'active')
  if (!['active', 'inactive'].includes(status)) {
    throw createError({ statusCode: 400, message: '商品状态值无效' })
  }
  const barcode = String(body?.barcode || '').trim() || null
  if (barcode) {
    const dupBarcode = await queryOne<{ id: number }>(
      'SELECT id FROM products WHERE store_id = ? AND barcode = ?',
      [storeId, barcode]
    )
    if (dupBarcode) throw createError({ statusCode: 400, message: '条码已存在' })
  }
  const dv = body?.discountable
  const discountVal = dv === undefined || dv === null || dv === ''
    ? 1
    : (dv === 0 || dv === false || dv === '0' || dv === 'false' ? 0 : 1)

  let shortCode = String(body?.short_code || '').trim()
  if (!shortCode) shortCode = await pinyinInitials(name)
  shortCode = shortCode.toUpperCase().replace(/\s+/g, '')

  let suffix = 0
  const baseCode = shortCode
  const usedCodes = new Set(
    (
      await query<{ short_code: string }>(
        'SELECT short_code FROM products WHERE store_id = ? AND (short_code = ? OR short_code LIKE ?)',
        [storeId, baseCode, prefixLike(baseCode)]
      )
    ).map((r) => r.short_code)
  )
  if (usedCodes.has(baseCode)) {
    let candidate = `${baseCode}1`
    suffix = 1
    while (usedCodes.has(candidate)) {
      suffix += 1
      candidate = `${baseCode}${suffix}`
    }
    shortCode = candidate
  }

  const stockQty = body?.stock_quantity != null && body?.stock_quantity !== ''
    ? toNonNegNumber(body.stock_quantity, '初始库存')
    : 0
  const stmts: { sql: string; params: any[] }[] = [{
    sql: `INSERT INTO products (store_id, name, short_code, barcode, primary_unit, selling_price,
       secondary_unit, conversion_rate, secondary_price, cost_price, discountable, stock_quantity, stock_alert, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))`,
    params: [
      storeId,
      name,
      shortCode,
      barcode,
      primaryUnit,
      sellingPrice,
      secondaryUnit,
      conversionRate,
      secondaryPrice,
      costPrice,
      discountVal,
      stockQty,
      stockAlert,
      status,
    ],
  }]
  if (stockQty > 0) {
    stmts.push({
      sql: `INSERT INTO product_stock_logs (product_id, store_id, type, quantity_change, stock_after, cost_price, notes, operator_id, created_at)
       SELECT id, ?, '入库', ?, ?, ?, '初始入库', ?, datetime('now', '+8 hours') FROM products WHERE store_id = ? AND short_code = ?`,
      params: [storeId, stockQty, stockQty, costPrice, auth.userId, storeId, shortCode],
    })
  }
  let productId: number | null = null
  try {
    const results = await batch(stmts)
    productId = results[0]?.meta?.last_row_id ?? null
  } catch (err: any) {
    if (isUniqueConflict(err)) {
      const msg = String(err?.message || '')
      if (/barcode/i.test(msg)) throw createError({ statusCode: 400, message: '条码已存在' })
      if (/short_code/i.test(msg)) throw createError({ statusCode: 400, message: '助记码已存在' })
      throw createError({ statusCode: 400, message: '商品已存在，请勿重复提交' })
    }
    throw err
  }
  if (!productId) throw createError({ statusCode: 500, message: '创建商品失败' })

  return await queryOne('SELECT * FROM products WHERE id = ?', [productId])
})
