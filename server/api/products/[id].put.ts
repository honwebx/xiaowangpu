import { execute, queryOne } from '../../utils/db'
import { requireManagerUp, ensureStoreAccess } from '../../utils/auth'
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
  requireManagerUp(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, message: '缺少商品ID' })

  const product = await queryOne<any>('SELECT * FROM products WHERE id = ?', [id])
  if (!product) throw createError({ statusCode: 404, message: '商品不存在' })
  ensureStoreAccess(event, Number(product.store_id))

  const body = await readBody(event)
  const fields: string[] = []
  const params: any[] = []

  const setIf = (key: string, val: any, transform: (v: any) => any = (v) => v) => {
    if (val !== undefined) {
      fields.push(`${key} = ?`)
      params.push(transform(val))
    }
  }
  setIf('name', body?.name, (v) => {
    const s = String(v).trim()
    if (!s) throw createError({ statusCode: 400, message: '商品名称不能为空' })
    return s
  })
  setIf('barcode', body?.barcode, (v) => {
    const s = String(v || '').trim() || null
    return s
  })
  if (body?.barcode !== undefined) {
    const s = String(body.barcode || '').trim() || null
    if (s) {
      const dup = await queryOne<{ id: number }>(
        'SELECT id FROM products WHERE store_id = ? AND barcode = ? AND id != ?',
        [product.store_id, s, id]
      )
      if (dup) throw createError({ statusCode: 400, message: '条码已存在' })
    }
  }
  setIf('primary_unit', body?.primary_unit, (v) => {
    const s = String(v).trim()
    if (!s) throw createError({ statusCode: 400, message: '主单位不能为空' })
    return s
  })
  if (body?.selling_price !== undefined) {
    setIf('selling_price', null, () => toNonNegNumber(body.selling_price, '售价'))
  }
  setIf('secondary_unit', body?.secondary_unit, (v) => String(v || '').trim() || null)
  if (body?.conversion_rate !== undefined && body?.conversion_rate !== null && body?.conversion_rate !== '') {
    const n = toNonNegNumber(body.conversion_rate, '换算比例')
    if (n === 0) throw createError({ statusCode: 400, message: '换算比例不能为0' })
    setIf('conversion_rate', null, () => n)
  } else if (body?.conversion_rate === null || body?.conversion_rate === '') {
    setIf('conversion_rate', null, () => null)
  }
  if (body?.secondary_price !== undefined && body?.secondary_price !== null && body?.secondary_price !== '') {
    setIf('secondary_price', null, () => toNonNegNumber(body.secondary_price, '副单位售价'))
  } else if (body?.secondary_price === null || body?.secondary_price === '') {
    setIf('secondary_price', null, () => null)
  }
  if (body?.cost_price !== undefined && body?.cost_price !== null && body?.cost_price !== '') {
    setIf('cost_price', null, () => toNonNegNumber(body.cost_price, '成本价'))
  } else if (body?.cost_price === null || body?.cost_price === '') {
    setIf('cost_price', null, () => null)
  }
  if (body?.stock_alert !== undefined && body?.stock_alert !== null && body?.stock_alert !== '') {
    setIf('stock_alert', null, () => toNonNegNumber(body.stock_alert, '库存预警'))
  } else if (body?.stock_alert === null || body?.stock_alert === '') {
    setIf('stock_alert', null, () => null)
  }
  setIf('discountable', body?.discountable, (v) => {
    if (v === 0 || v === false || v === '0' || v === 'false') return 0
    return 1
  })
  if (body?.status !== undefined) {
    const s = String(body.status)
    if (!['active', 'inactive'].includes(s)) {
      throw createError({ statusCode: 400, message: '商品状态值无效' })
    }
    setIf('status', null, () => s)
  }
  if (body?.short_code !== undefined) {
    const sc = String(body.short_code).trim().toUpperCase().replace(/\s+/g, '')
    if (!sc) throw createError({ statusCode: 400, message: '助记码不能为空' })
    const dup = await queryOne<{ id: number }>(
      'SELECT id FROM products WHERE store_id = ? AND short_code = ? AND id != ?',
      [product.store_id, sc, id]
    )
    if (dup) throw createError({ statusCode: 400, message: '助记码已存在' })
    fields.push('short_code = ?'); params.push(sc)
  }

  if (fields.length === 0) return product
  const nextSecondaryUnit = body?.secondary_unit !== undefined
    ? String(body.secondary_unit || '').trim() || null
    : product.secondary_unit
  const nextConversionRate = body?.conversion_rate !== undefined
    ? (body.conversion_rate == null || body.conversion_rate === '' ? null : Number(body.conversion_rate))
    : product.conversion_rate
  if (nextSecondaryUnit && nextConversionRate == null) {
    throw createError({ statusCode: 400, message: '填写副单位时换算比例必填' })
  }
  fields.push("updated_at = datetime('now', '+8 hours')")
  params.push(id)
  try {
    await execute(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, params)
  } catch (err: any) {
    if (isUniqueConflict(err)) {
      const msg = String(err?.message || '')
      if (/barcode/i.test(msg)) throw createError({ statusCode: 400, message: '条码已存在' })
      if (/short_code/i.test(msg)) throw createError({ statusCode: 400, message: '助记码已存在' })
      throw createError({ statusCode: 400, message: '商品已存在，请勿重复提交' })
    }
    throw err
  }
  return await queryOne('SELECT * FROM products WHERE id = ?', [id])
})
