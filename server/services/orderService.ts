import { execute, query, queryOne, batch, round2 } from '../utils/db'
import { isUniqueConflict } from '../utils/idempotency'
import { notifyMember } from '../utils/sms/notify'

export interface OrderItemInput {
  product_id?: number | null
  product_name: string
  product_unit: string
  unit_price: number
  original_price?: number
  quantity: number
  base_quantity?: number
  base_unit?: string
  cost_price?: number | null
  count_service_id?: number | null
  discount_amount?: number
}

export interface CreateOrderInput {
  store_id: number
  member_id?: number | null
  items: OrderItemInput[]
  cash_amount: number
  balance_amount: number
  points_amount: number
  order_discount?: number
  operator_id: number
  idempotency_key?: string
  // 注入 event 用于 waitUntil（异步短信），调用方未传则同步
  event?: any
}

interface SettingsRow {
  points_earn_rate: number
  points_redeem_amount: number
  points_redeem_value: number
  balance_payment_enabled: number
  points_payment_enabled: number
}

interface ProductRow {
  id: number
  store_id: number
  name: string
  primary_unit: string
  selling_price: number
  cost_price: number | null
  stock_quantity: number
  status: string
}

interface MemberRow {
  id: number
  store_id: number
  phone: string
  balance: number
  points: number
}

interface ExistingOrderRow {
  id: number
  total_amount: number
  payable_amount: number
  cash_amount: number
  balance_amount: number
  points_value: number
  points_earned: number
}

async function buildIdempotentResult(row: ExistingOrderRow) {
  const paid = round2(Number(row.cash_amount) + Number(row.balance_amount) + Number(row.points_value))
  return {
    order_id: Number(row.id),
    total_amount: Number(row.total_amount),
    change: round2(paid - Number(row.payable_amount)),
    points_earned: Number(row.points_earned),
  }
}

async function findCompleteIdempotentOrder(storeId: number, key: string, expectedItems: number) {
  const existing = await queryOne<ExistingOrderRow>(
    `SELECT id, total_amount, payable_amount, cash_amount, balance_amount, points_value, points_earned
       FROM orders WHERE store_id = ? AND idempotency_key = ?`,
    [storeId, key]
  )
  if (!existing) return null
  const cnt = await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM order_items WHERE order_id = ?', [existing.id])
  if (Number(cnt?.c) !== expectedItems) return null
  return buildIdempotentResult(existing)
}

async function cleanupIncompleteSaleOrder(orderId: number, storeId: number) {
  const order = await queryOne<{ member_id: number | null; balance_amount: number; points_amount: number; points_earned: number }>(
    'SELECT member_id, balance_amount, points_amount, points_earned FROM orders WHERE id = ?',
    [orderId]
  )
  if (!order) return
  const items = await query<{ product_id: number | null; base_quantity: number | null }>(
    'SELECT product_id, base_quantity FROM order_items WHERE order_id = ?',
    [orderId]
  )
  const stmts: { sql: string; params: any[] }[] = [
    { sql: 'DELETE FROM order_items WHERE order_id = ?', params: [orderId] },
    { sql: 'DELETE FROM product_stock_logs WHERE related_order_id = ?', params: [orderId] },
    { sql: 'DELETE FROM balance_logs WHERE related_order_id = ?', params: [orderId] },
    { sql: 'DELETE FROM point_logs WHERE related_order_id = ?', params: [orderId] },
  ]
  const stockByProduct = new Map<number, number>()
  for (const it of items) {
    if (it.product_id && it.base_quantity) {
      stockByProduct.set(it.product_id, (stockByProduct.get(it.product_id) || 0) + Number(it.base_quantity))
    }
  }
  const committed = await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM order_items WHERE order_id = ?', [orderId]).catch(() => null)
  for (const [pid, qty] of stockByProduct) {
    if (Number(committed?.c || 0) > 0) {
      stmts.push({ sql: 'UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?', params: [qty, pid] })
    }
  }
  if (order.member_id && Number(committed?.c || 0) > 0) {
    stmts.push({
      sql: 'UPDATE members SET balance = balance + ?, points = points - ? WHERE id = ?',
      params: [Number(order.balance_amount) || 0, (Number(order.points_earned) || 0) - (Number(order.points_amount) || 0), order.member_id],
    })
  }
  stmts.push({ sql: 'DELETE FROM orders WHERE id = ?', params: [orderId] })
  await batch(stmts).catch(() => {})
}

async function loadSettings(storeId: number): Promise<SettingsRow> {
  const row = await queryOne<SettingsRow>('SELECT * FROM settings WHERE store_id = ?', [storeId])
  return (
    row || {
      points_earn_rate: 1,
      points_redeem_amount: 100,
      points_redeem_value: 1,
      balance_payment_enabled: 1,
      points_payment_enabled: 1,
    }
  )
}

export async function createOrder(input: CreateOrderInput): Promise<{
  order_id: number
  total_amount: number
  change: number
  points_earned: number
}> {
  const storeId = Number(input.store_id)
  if (!storeId) throw createError({ statusCode: 400, message: '缺少店铺' })
  if (!input.items || input.items.length === 0) {
    throw createError({ statusCode: 400, message: '订单商品不能为空' })
  }

  const store = await queryOne<{ id: number }>('SELECT id FROM stores WHERE id = ?', [storeId])
  if (!store) throw createError({ statusCode: 404, message: '店铺不存在' })

  if (input.idempotency_key) {
    const reused = await findCompleteIdempotentOrder(storeId, input.idempotency_key, input.items.length)
    if (reused) return reused
    const existing = await queryOne<{ id: number }>(
      'SELECT id FROM orders WHERE store_id = ? AND idempotency_key = ?',
      [storeId, input.idempotency_key]
    )
    if (existing) await cleanupIncompleteSaleOrder(Number(existing.id), storeId)
  }

  const settings = await loadSettings(storeId)

  const cashAmount = round2(Number(input.cash_amount) || 0)
  const balanceAmount = round2(Number(input.balance_amount) || 0)
  const pointsAmount = Math.max(0, Math.floor(Number(input.points_amount) || 0))
  const operatorId = Number(input.operator_id) || null
  const memberId = input.member_id ? Number(input.member_id) : null

  const redeemAmount = Number(settings.points_redeem_amount) || 100
  const redeemValue = Number(settings.points_redeem_value) || 1
  const pointsValue = round2(pointsAmount > 0 ? (pointsAmount / redeemAmount) * redeemValue : 0)

  if (balanceAmount > 0 && !settings.balance_payment_enabled) {
    throw createError({ statusCode: 400, message: '余额支付未开启' })
  }
  if (pointsAmount > 0 && !settings.points_payment_enabled) {
    throw createError({ statusCode: 400, message: '积分支付未开启' })
  }
  if (pointsAmount > 0 && pointsAmount < redeemAmount) {
    throw createError({ statusCode: 400, message: `积分需满${redeemAmount}起兑` })
  }
  if (pointsAmount > 0 && pointsAmount % redeemAmount !== 0) {
    throw createError({ statusCode: 400, message: `积分需为${redeemAmount}的整数倍` })
  }

  let totalAmount = 0
  let memberDiscount = 0
  const enrichedItems: Array<{
    product_id: number | null
    product_name: string
    product_unit: string
    unit_price: number
    original_price: number
    quantity: number
    base_quantity: number
    base_unit: string
    subtotal: number
    discount_amount: number
    cost_price: number | null
    count_service_id: number | null
  }> = []
  const productIds: number[] = []

  for (const raw of input.items) {
    const unitPrice = round2(Number(raw.unit_price) || 0)
    const originalPrice = round2(Number(raw.original_price) || 0)
    const quantity = round2(Number(raw.quantity) || 0)
    if (unitPrice < 0 || originalPrice < 0) throw createError({ statusCode: 400, message: '商品价格不能为负' })
    if (quantity <= 0) throw createError({ statusCode: 400, message: '商品数量必须大于0' })
    const baseQuantity = round2(Number(raw.base_quantity) || quantity)
    const baseUnit = String(raw.base_unit || raw.product_unit || '')
    const subtotal = round2(unitPrice * quantity)
    const originalSubtotal = round2(originalPrice * quantity)
    const discountAmount = round2(Number(raw.discount_amount) || 0)
    totalAmount = round2(totalAmount + originalSubtotal)
    memberDiscount = round2(memberDiscount + (originalSubtotal - subtotal))
    const pid = raw.product_id ? Number(raw.product_id) : null
    if (pid) productIds.push(pid)
    enrichedItems.push({
      product_id: pid,
      product_name: String(raw.product_name || ''),
      product_unit: String(raw.product_unit || ''),
      unit_price: unitPrice,
      original_price: originalPrice,
      quantity,
      base_quantity: baseQuantity,
      base_unit: baseUnit,
      subtotal,
      discount_amount: discountAmount,
      cost_price: raw.cost_price != null ? Number(raw.cost_price) : null,
      count_service_id: raw.count_service_id ? Number(raw.count_service_id) : null,
    })
  }

  const orderDiscount = round2(Number(input.order_discount) || 0)
  const sumSubtotal = round2(totalAmount - memberDiscount)
  if (orderDiscount < 0 || orderDiscount > sumSubtotal + 0.001) {
    throw createError({ statusCode: 400, message: '优惠金额无效' })
  }
  const payableAmount = round2(totalAmount - memberDiscount - orderDiscount)

  const paid = round2(cashAmount + balanceAmount + pointsValue)
  if (paid < payableAmount - 0.001) {
    throw createError({ statusCode: 400, message: '支付金额不足' })
  }
  const change = round2(paid - payableAmount)

  let member: MemberRow | null = null
  let newBalance = 0
  let newPoints = 0
  let pointsEarned = 0

  if (memberId) {
    member = await queryOne<MemberRow>('SELECT id, store_id, phone, balance, points FROM members WHERE id = ? AND store_id = ?', [
      memberId,
      storeId,
    ])
    if (!member) throw createError({ statusCode: 404, message: '会员不存在' })
    newBalance = round2(member.balance)
    newPoints = member.points
    if (balanceAmount > 0) {
      if (newBalance < balanceAmount - 0.001) {
        throw createError({ statusCode: 400, message: '会员余额不足' })
      }
      newBalance = round2(newBalance - balanceAmount)
    }
    if (pointsAmount > 0) {
      if (newPoints < pointsAmount) {
        throw createError({ statusCode: 400, message: '会员积分不足' })
      }
      newPoints -= pointsAmount
    }
    pointsEarned = Math.floor((cashAmount + balanceAmount) * (Number(settings.points_earn_rate) || 0))
    if (pointsEarned < 0) pointsEarned = 0
    newPoints += pointsEarned
  } else {
    if (balanceAmount > 0 || pointsAmount > 0) {
      throw createError({ statusCode: 400, message: '余额或积分支付需选择会员' })
    }
  }

  // 一次 IN 查询所有商品；D1 单条语句最多 100 绑定参数，按 50 切分
  const productMap = new Map<number, ProductRow>()
  if (productIds.length > 0) {
    const uniqueIds = [...new Set(productIds)]
    for (let i = 0; i < uniqueIds.length; i += 50) {
      const group = uniqueIds.slice(i, i + 50)
      const placeholders = group.map(() => '?').join(',')
      const rows = await query<ProductRow>(
        `SELECT id, store_id, name, primary_unit, selling_price, cost_price, stock_quantity, status
           FROM products
          WHERE id IN (${placeholders}) AND store_id = ?`,
        [...group, storeId]
      )
      for (const r of rows) productMap.set(r.id, r)
    }
  }

  const stockOps: Array<{ product: ProductRow; newStock: number; quantity: number }> = []
  function opNewStockFor(ops: typeof stockOps, i: number): number {
    return ops[i]?.newStock ?? 0
  }

  for (const item of enrichedItems) {
    if (item.count_service_id) {
      throw createError({ statusCode: 400, message: '计次项目请到会员管理页分配' })
    }
    if (item.product_id) {
      const product = productMap.get(item.product_id)
      if (!product) throw createError({ statusCode: 404, message: '商品不存在' })
      if (product.status !== 'active') {
        throw createError({ statusCode: 400, message: `商品「${product.name}」已下架，无法开单` })
      }
      const stockDelta = item.base_quantity || item.quantity
      if (product.stock_quantity < stockDelta - 0.0001) {
        throw createError({ statusCode: 400, message: `商品「${product.name}」库存不足` })
      }
      const newStock = round2(product.stock_quantity - stockDelta)
      stockOps.push({ product, newStock, quantity: stockDelta })
      item.product_name = item.product_name || product.name
      item.product_unit = item.product_unit || product.primary_unit
      item.cost_price = product.cost_price != null ? Number(product.cost_price) : null
    } else {
      throw createError({ statusCode: 400, message: '商品行缺少商品ID或计次项目ID' })
    }
  }

  // 1) INSERT orders RETURNING id（单次往返拿到 orderId）
  let orderId: number
  try {
    const orderRes = await execute(
      `INSERT INTO orders (store_id, type, member_id, original_order_id, total_amount, member_discount, order_discount, payable_amount, points_earned, cash_amount, balance_amount, points_amount, points_value, operator_id, idempotency_key, created_at)
       VALUES (?, 'sale', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours')) RETURNING id`,
      [storeId, memberId, totalAmount, memberDiscount, orderDiscount, payableAmount, pointsEarned, cashAmount, balanceAmount, pointsAmount, pointsValue, operatorId, input.idempotency_key ?? null]
    )
    const head: any = orderRes
    orderId = Number(head?.results?.[0]?.id ?? head?.meta?.last_row_id)
    if (!orderId) throw createError({ statusCode: 500, message: '创建订单失败' })
  } catch (err: any) {
    if (err.statusCode) throw err
    if (input.idempotency_key && isUniqueConflict(err)) {
      const reused = await findCompleteIdempotentOrder(storeId, input.idempotency_key, input.items.length)
      if (reused) return reused
    }
    throw err
  }

  // 2) 其余 INSERT/UPDATE 一次性 batch
  const stmts: { sql: string; params: any[] }[] = []
  const condIdx: number[] = []

  for (const item of enrichedItems) {
    stmts.push({
      sql: `INSERT INTO order_items (order_id, product_id, product_name, product_unit, unit_price, original_price, quantity, base_quantity, base_unit, subtotal, discount_amount, cost_price, count_service_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))`,
      params: [
        orderId,
        item.product_id,
        item.product_name,
        item.product_unit,
        item.unit_price,
        item.original_price,
        item.quantity,
        item.base_quantity,
        item.base_unit,
        item.subtotal,
        item.discount_amount,
        item.cost_price,
        item.count_service_id,
      ],
    })
  }

  // 库存 UPDATE 用 RETURNING stock_quantity 拿真实值，balance/points 同理，
  // 后续 INSERT 的 stock_after/balance_after 全部取自 UPDATE 的 RETURNING，避免并发下日志与实际值不一致
  const stockUpdateIdxs: number[] = []
  for (const op of stockOps) {
    stockUpdateIdxs.push(stmts.length)
    stmts.push({
      sql: 'UPDATE products SET stock_quantity = stock_quantity - ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND stock_quantity >= ? RETURNING stock_quantity',
      params: [op.quantity, op.product.id, op.quantity],
    })
  }

  let memberUpdateIdx = -1
  if (member) {
    memberUpdateIdx = stmts.length
    stmts.push({
      sql: 'UPDATE members SET balance = balance - ?, points = points + ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND balance >= ? AND points >= ? RETURNING balance, points',
      params: [balanceAmount, pointsEarned - pointsAmount, member.id, balanceAmount, pointsAmount],
    })
  }

  let actualNewBalance = newBalance
  let actualNewPoints = newPoints

  try {
    if (stmts.length > 0) {
      const results = await batch(stmts)
      for (const idx of stockUpdateIdxs) {
        if (!results[idx]?.meta?.changes) {
          throw createError({ statusCode: 400, message: '库存或会员余额/积分不足（并发冲突），请重试' })
        }
      }
      if (member && memberUpdateIdx >= 0 && !results[memberUpdateIdx]?.meta?.changes) {
        throw createError({ statusCode: 400, message: '库存或会员余额/积分不足（并发冲突），请重试' })
      }

      // 库存日志用 RETURNING 的真实 stock_after
      const stockAfterByProduct = new Map<number, number>()
      for (let i = 0; i < stockUpdateIdxs.length; i++) {
        const idx = stockUpdateIdxs[i]
        const row = results[idx]?.results?.[0]
        const actual = row ? Number(row.stock_quantity) : opNewStockFor(stockOps, i)
        stockAfterByProduct.set(stockOps[i].product.id, actual)
      }

      // 会员余额/积分日志用 RETURNING 的真实值
      const memberRow = member ? (results[memberUpdateIdx]?.results?.[0] || null) : null
      actualNewBalance = memberRow ? Number(memberRow.balance) : newBalance
      actualNewPoints = memberRow ? Number(memberRow.points) : newPoints

      const logStmts: { sql: string; params: any[] }[] = []
      for (const op of stockOps) {
        logStmts.push({
          sql: `INSERT INTO product_stock_logs (product_id, store_id, type, quantity_change, stock_after, related_order_id, operator_id, created_at)
                VALUES (?, ?, '销售', ?, ?, ?, ?, datetime('now', '+8 hours'))`,
          params: [op.product.id, storeId, -op.quantity, stockAfterByProduct.get(op.product.id) ?? op.newStock, orderId, operatorId],
        })
      }
      if (member) {
        if (balanceAmount > 0) {
          logStmts.push({
            sql: `INSERT INTO balance_logs (member_id, store_id, type, amount, balance_after, related_order_id, operator_id, created_at)
                  VALUES (?, ?, 'consume', ?, ?, ?, ?, datetime('now', '+8 hours'))`,
            params: [member!.id, storeId, balanceAmount, actualNewBalance, orderId, operatorId],
          })
        }
        if (pointsAmount > 0) {
          logStmts.push({
            sql: `INSERT INTO point_logs (member_id, store_id, type, amount, balance_after, related_order_id, operator_id, created_at)
                  VALUES (?, ?, 'redeem', ?, ?, ?, ?, datetime('now', '+8 hours'))`,
            params: [member!.id, storeId, pointsAmount, actualNewPoints - pointsEarned, orderId, operatorId],
          })
        }
        if (pointsEarned > 0) {
          logStmts.push({
            sql: `INSERT INTO point_logs (member_id, store_id, type, amount, balance_after, related_order_id, operator_id, created_at)
                  VALUES (?, ?, 'earn', ?, ?, ?, ?, datetime('now', '+8 hours'))`,
            params: [member!.id, storeId, pointsEarned, actualNewPoints, orderId, operatorId],
          })
        }
      }
      if (logStmts.length > 0) await batch(logStmts)
    }
  } catch (err: any) {
    if (err.statusCode) throw err
    const compStmts: { sql: string; params: any[] }[] = [
      { sql: 'DELETE FROM order_items WHERE order_id = ?', params: [orderId] },
      { sql: 'DELETE FROM product_stock_logs WHERE related_order_id = ?', params: [orderId] },
      { sql: 'DELETE FROM balance_logs WHERE related_order_id = ?', params: [orderId] },
      { sql: 'DELETE FROM point_logs WHERE related_order_id = ?', params: [orderId] },
      { sql: 'DELETE FROM orders WHERE id = ?', params: [orderId] },
    ]
    const committed = await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM order_items WHERE order_id = ?', [orderId]).catch(() => null)
    if (Number(committed?.c || 0) > 0) {
      for (const op of stockOps) {
        compStmts.push({
          sql: 'UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?',
          params: [op.quantity, op.product.id],
        })
      }
      if (member) {
        compStmts.push({
          sql: 'UPDATE members SET balance = balance + ?, points = points - ? WHERE id = ?',
          params: [balanceAmount, pointsEarned - pointsAmount, member.id],
        })
      }
    }
    await batch(compStmts).catch(() => {})
    throw createError({ statusCode: 500, message: '订单写入失败: ' + (err?.message || '未知错误') })
  }

  // dashboard 缓存仅靠 60s TTL（逐单失效会使营业时间缓存永不命中）

  try {
    if (member) {
      const tasks: Promise<void>[] = []
      if (balanceAmount > 0) {
        tasks.push(notifyMember(storeId, member.phone, 'balance', {
          amount: balanceAmount.toFixed(2),
          balance: actualNewBalance.toFixed(2),
        }))
      }
      if (pointsAmount > 0) {
        tasks.push(notifyMember(storeId, member.phone, 'points', {
          points: String(pointsAmount),
          balance: String(actualNewPoints),
        }))
      }
      if (pointsEarned > 0) {
        tasks.push(notifyMember(storeId, member.phone, 'points', {
          points: String(pointsEarned),
          balance: String(actualNewPoints),
        }))
      }
      if (tasks.length > 0) {
        const ctx = input.event?.context?.cloudflare?.ctx
        if (ctx?.waitUntil) {
          for (const t of tasks) ctx.waitUntil(t)
        } else {
          await Promise.all(tasks).catch(() => {})
        }
      }
    }
  } catch {}

  return { order_id: orderId, total_amount: totalAmount, change, points_earned: pointsEarned }
}
