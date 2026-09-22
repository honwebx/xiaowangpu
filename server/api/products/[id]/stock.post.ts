import { batch, execute, queryOne, round2 } from '../../../utils/db'
import { requireManagerUp, ensureStoreAccess, getAuth } from '../../../utils/auth'
import { findIdempotentLog, isUniqueConflict } from '../../../utils/idempotency'

function toPositiveNumber(v: any, field: string): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) {
    throw createError({ statusCode: 400, message: `${field}必须大于0` })
  }
  return n
}

export default defineEventHandler(async (event) => {
  const auth = requireManagerUp(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, message: '缺少商品ID' })

  const product = await queryOne<any>('SELECT * FROM products WHERE id = ?', [id])
  if (!product) throw createError({ statusCode: 404, message: '商品不存在' })
  ensureStoreAccess(event, Number(product.store_id))
  const storeId = Number(product.store_id)

  const body = await readBody(event)
  const type = String(body?.type || '')
  if (!['入库', '出库', '盘点'].includes(type)) {
    throw createError({ statusCode: 400, message: '库存操作类型无效' })
  }

  const idempotencyKey = body?.idempotency_key ? String(body.idempotency_key).slice(0, 64) : undefined
  if (idempotencyKey && type !== '盘点') {
    const existing = await findIdempotentLog<{ id: number }>(storeId, idempotencyKey, 'product_stock_logs')
    if (existing) return await queryOne('SELECT id, stock_quantity FROM products WHERE id = ?', [id])
  }

  const current = Number(product.stock_quantity) || 0
  let change = 0
  let newStock = current
  let updateSql = ''
  let updateParams: any[] = []

  if (type === '盘点') {
    if (body?.stock_after === undefined || body?.stock_after === null) {
      throw createError({ statusCode: 400, message: '盘点需提供盘点后库存' })
    }
    newStock = round2(Number(body.stock_after))
    if (!Number.isFinite(newStock)) {
      throw createError({ statusCode: 400, message: '盘点数量无效' })
    }
    if (newStock < 0) {
      throw createError({ statusCode: 400, message: '盘点数量不能为负' })
    }
    change = round2(newStock - current)
    updateSql = 'UPDATE products SET stock_quantity = ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND store_id = ? AND stock_quantity = ?'
    updateParams = [newStock, id, storeId, current]
  } else {
    if (body?.quantity_change === undefined || body?.quantity_change === null || body?.quantity_change === '') {
      throw createError({ statusCode: 400, message: '请填写数量' })
    }
    const qty = toPositiveNumber(body.quantity_change, '数量')
    if (type === '出库' && !String(body?.notes || '').trim()) {
      throw createError({ statusCode: 400, message: '请填写出库原因' })
    }
    change = type === '入库' ? round2(qty) : round2(-qty)
    newStock = round2(current + change)
    if (newStock < 0) {
      throw createError({ statusCode: 400, message: '库存不足，无法出库' })
    }
    if (type === '入库') {
      updateSql = 'UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND store_id = ? RETURNING stock_quantity'
      updateParams = [round2(qty), id, storeId]
    } else {
      updateSql = 'UPDATE products SET stock_quantity = stock_quantity - ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND store_id = ? AND stock_quantity >= ? RETURNING stock_quantity'
      updateParams = [round2(qty), id, storeId, round2(qty)]
    }
  }

  if (body?.cost_price != null && body?.cost_price !== '') {
    const cp = Number(body.cost_price)
    if (!Number.isFinite(cp) || cp < 0) {
      throw createError({ statusCode: 400, message: '成本价必须为非负数字' })
    }
  }
  const logParams = [
    id, storeId, type, change, newStock,
    body?.cost_price != null && body?.cost_price !== '' ? Number(body.cost_price) : null,
    body?.supplier || null,
    body?.notes || null,
    auth.userId,
    idempotencyKey ?? null,
  ]
  const logSql = `INSERT INTO product_stock_logs (product_id, store_id, type, quantity_change, stock_after, cost_price, supplier, notes, operator_id, idempotency_key, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))`

  if (type === '盘点') {
    try {
      const results = await batch([
        { sql: updateSql, params: updateParams },
        { sql: logSql, params: logParams },
      ])
      if (!results[0]?.meta?.changes) {
        throw createError({ statusCode: 409, message: '库存已被其他操作修改，请重新盘点' })
      }
    } catch (err) {
      if (isUniqueConflict(err) && idempotencyKey) {
        return await queryOne('SELECT id, stock_quantity FROM products WHERE id = ?', [id])
      }
      throw err
    }
  } else {
    const updResults = await batch([{ sql: updateSql, params: updateParams }])
    const updRes: any = updResults[0]
    if (!updRes?.meta?.changes) {
      throw createError({ statusCode: type === '出库' ? 400 : 404, message: type === '出库' ? '库存不足，无法出库' : '商品不存在或已删除' })
    }
    const actualRow = updRes?.results?.[0]
    if (actualRow != null) logParams[4] = round2(Number(actualRow.stock_quantity))
    try {
      await execute(logSql, logParams)
    } catch (err) {
      await execute('UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND store_id = ?', [round2(-change), id, storeId]).catch(() => {})
      if (isUniqueConflict(err) && idempotencyKey) {
        return await queryOne('SELECT id, stock_quantity FROM products WHERE id = ?', [id])
      }
      throw err
    }
  }

  return await queryOne('SELECT id, stock_quantity FROM products WHERE id = ?', [id])
})
