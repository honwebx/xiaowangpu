import { execute, query, queryOne, batch, round2 } from '../utils/db'
import { isUniqueConflict } from '../utils/idempotency'
import { notifyMember } from '../utils/sms/notify'

export interface ReturnItemInput {
  order_item_id: number
  quantity: number
  refund_amount?: number
}

export interface CreateReturnInput {
  original_order_id: number
  items: ReturnItemInput[]
  operator_id: number
  refund_amount?: number
  idempotency_key?: string
  event?: any
}

interface OriginalOrder {
  id: number
  store_id: number
  type: string
  member_id: number | null
  total_amount: number
  member_discount?: number
  order_discount?: number
  payable_amount?: number
  points_earned?: number
  cash_amount: number
  balance_amount: number
  points_amount: number
  points_value: number
  original_order_id: number | null
}

interface OriginalItem {
  id: number
  order_id: number
  product_id: number | null
  product_name: string
  product_unit: string
  base_unit: string
  unit_price: number
  original_price: number
  quantity: number
  base_quantity: number
  subtotal: number
  discount_amount: number
  cost_price: number | null
  count_service_id: number | null
}

function itemKey(it: { product_id: number | null; count_service_id: number | null }): string {
  if (it.count_service_id) return 's:' + it.count_service_id
  return 'p:' + (it.product_id ?? 0)
}

async function getPriorDeductedPoints(memberId: number, originalOrderId: number, excludeOrderId?: number): Promise<number> {
  const excludeClause = excludeOrderId ? 'AND id != ?' : ''
  const params = excludeOrderId ? [memberId, originalOrderId, excludeOrderId] : [memberId, originalOrderId]
  const row = await queryOne<{ d: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS d FROM point_logs
       WHERE member_id = ? AND type = 'deduct' AND related_order_id IN
         (SELECT id FROM orders WHERE type = 'return' AND original_order_id = ? ${excludeClause})`,
    params
  )
  return Number(row?.d || 0)
}

interface ReturnableRow {
  product_id: number | null
  count_service_id: number | null
  base_quantity: number
  payable_amount: number
  point_amount: number
}

interface ExistingReturnRow {
  id: number
  payable_amount: number
}

async function buildIdempotentReturnResult(row: ExistingReturnRow) {
  return { return_order_id: Number(row.id), refund_amount: Number(row.payable_amount) }
}

async function findCompleteIdempotentReturn(storeId: number, key: string, expectedItems: number) {
  const existing = await queryOne<ExistingReturnRow>(
    `SELECT id, payable_amount FROM orders WHERE store_id = ? AND idempotency_key = ? AND type = 'return'`,
    [storeId, key]
  )
  if (!existing) return null
  const cnt = await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM order_items WHERE order_id = ?', [existing.id])
  if (Number(cnt?.c) !== expectedItems) return null
  return buildIdempotentReturnResult(existing)
}

async function cleanupIncompleteReturnOrder(orderId: number, storeId: number) {
  const order = await queryOne<{
    member_id: number | null
    balance_amount: number
    points_amount: number
    original_order_id: number
    payable_amount: number
  }>(
    'SELECT member_id, balance_amount, points_amount, original_order_id, payable_amount FROM orders WHERE id = ?',
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
  const hasCommitted = Number(committed?.c || 0) > 0
  for (const [pid, qty] of stockByProduct) {
    if (hasCommitted) {
      stmts.push({ sql: 'UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?', params: [qty, pid] })
    }
  }
  if (order.member_id && hasCommitted) {
    stmts.push({
      sql: 'UPDATE members SET balance = balance - ? WHERE id = ?',
      params: [Number(order.balance_amount) || 0, order.member_id],
    })
    if (Number(order.points_amount) > 0) {
      const orig = await queryOne<{ points_earned: number; payable_amount: number }>(
        'SELECT points_earned, payable_amount FROM orders WHERE id = ?',
        [order.original_order_id]
      )
      let realSafeDeduct = 0
      if (orig) {
        const priorDeducted = await getPriorDeductedPoints(order.member_id, order.original_order_id, orderId)
        const origPayable = Number(orig.payable_amount) || 0
        const maxDeduct = Math.max(0, (Number(orig.points_earned) || 0) - priorDeducted)
        const earnedPointsToDeduct = Math.min(
          maxDeduct,
          orig.points_earned
            ? Math.round(Number(orig.points_earned) * (origPayable > 0 ? Math.min(1, Number(order.payable_amount) / origPayable) : 0))
            : 0
        )
        const member = await queryOne<{ points: number }>('SELECT points FROM members WHERE id = ?', [order.member_id])
        const safeDeduct = Math.min(earnedPointsToDeduct, Math.max(0, Number(orig.points_earned) - priorDeducted))
        realSafeDeduct = Math.min(safeDeduct, Math.max(0, Number(member?.points || 0) + Number(order.points_amount)))
      }
      stmts.push({
        sql: 'UPDATE members SET points = points - ? WHERE id = ?',
        params: [Number(order.points_amount) - realSafeDeduct, order.member_id],
      })
    }
  }
  stmts.push({ sql: 'DELETE FROM orders WHERE id = ?', params: [orderId] })
  await batch(stmts).catch(() => {})
}

export async function createReturn(input: CreateReturnInput): Promise<{
  return_order_id: number
  refund_amount: number
}> {
  const originalOrderId = Number(input.original_order_id)
  if (!originalOrderId) throw createError({ statusCode: 400, message: '缺少原订单' })
  const operatorId = Number(input.operator_id) || null
  if (!input.items || input.items.length === 0) {
    throw createError({ statusCode: 400, message: '退货商品不能为空' })
  }

  const original = await queryOne<OriginalOrder>('SELECT * FROM orders WHERE id = ?', [originalOrderId])
  if (!original) throw createError({ statusCode: 404, message: '原订单不存在' })
  if (original.type !== 'sale') {
    throw createError({ statusCode: 400, message: '只能对销售订单进行退货' })
  }
  const storeId = original.store_id

  if (input.idempotency_key) {
    const reused = await findCompleteIdempotentReturn(storeId, input.idempotency_key, input.items.length)
    if (reused) return reused
    const existing = await queryOne<{ id: number }>(
      "SELECT id FROM orders WHERE store_id = ? AND idempotency_key = ? AND type = 'return'",
      [storeId, input.idempotency_key]
    )
    if (existing) await cleanupIncompleteReturnOrder(Number(existing.id), storeId)
  }

  // 原单 items + 该原单的所有历史退货 items：UNION ALL 两段各自走索引（原单为 sale，两段无交集）
  const orderItems = await query<OriginalItem & { order_type: string; original_order_id: number | null }>(
    `SELECT oi.id, oi.order_id, oi.product_id, oi.product_name, oi.product_unit, oi.base_unit, oi.unit_price, oi.original_price,
            oi.quantity, oi.base_quantity, oi.subtotal, oi.discount_amount, oi.cost_price, oi.count_service_id,
            o.type AS order_type, o.original_order_id
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.order_id = ?
      UNION ALL
      SELECT oi.id, oi.order_id, oi.product_id, oi.product_name, oi.product_unit, oi.base_unit, oi.unit_price, oi.original_price,
             oi.quantity, oi.base_quantity, oi.subtotal, oi.discount_amount, oi.cost_price, oi.count_service_id,
             o.type AS order_type, o.original_order_id
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
       WHERE o.type = 'return' AND o.original_order_id = ?`,
    [originalOrderId, originalOrderId]
  )
  const originalItems: OriginalItem[] = []
  const returnedItems: Array<{ product_id: number | null; count_service_id: number | null; base_quantity: number }> = []
  for (const r of orderItems) {
    if (r.order_id === originalOrderId && r.order_type === 'sale') {
      const { order_type, original_order_id, ...oi } = r
      originalItems.push(oi as OriginalItem)
    } else if (r.order_type === 'return' && r.original_order_id === originalOrderId) {
      returnedItems.push({ product_id: r.product_id, count_service_id: r.count_service_id, base_quantity: Number(r.base_quantity) })
    }
  }

  const itemById = new Map<number, OriginalItem>()
  for (const it of originalItems) itemById.set(it.id, it)

  const originalQtyByKey = new Map<string, number>()
  for (const it of originalItems) {
    const k = itemKey(it)
    originalQtyByKey.set(k, (originalQtyByKey.get(k) || 0) + it.base_quantity)
  }

  const returnedQtyByKey = new Map<string, number>()
  for (const r of returnedItems) {
    const k = itemKey(r)
    returnedQtyByKey.set(k, (returnedQtyByKey.get(k) || 0) + Number(r.base_quantity))
  }

  // 合并 prior_refunded
  const priorReturned = await queryOne<{ v: number }>(
    `SELECT COALESCE(SUM(payable_amount),0) AS v FROM orders WHERE original_order_id = ? AND type = 'return'`,
    [originalOrderId]
  )
  const priorRefunded = Number(priorReturned?.v || 0)

  const returnLines: Array<{ orig: OriginalItem; quantity: number; refund: number }> = []
  let refundAmount = 0
  let fairRefund = 0
  const tracked = new Map<string, number>()

  for (const ri of input.items) {
    const oiId = Number(ri.order_item_id)
    const qty = round2(Number(ri.quantity) || 0)
    if (qty <= 0) throw createError({ statusCode: 400, message: '退货数量必须大于0' })
    const orig = itemById.get(oiId)
    if (!orig) throw createError({ statusCode: 400, message: '退货商品不属于该订单' })
    const k = itemKey(orig)
    const returnedSoFar = (returnedQtyByKey.get(k) || 0) + (tracked.get(k) || 0)
    const maxQty = originalQtyByKey.get(k) || 0
    if (returnedSoFar + qty > maxQty + 0.0001) {
      throw createError({ statusCode: 400, message: `「${orig.product_name}」退货数量超出可退数量` })
    }
    tracked.set(k, (tracked.get(k) || 0) + qty)
    const origBaseQty = orig.base_quantity
    const ratio = origBaseQty > 0 ? qty / origBaseQty : 0
    const lineFair = round2((orig.subtotal - (orig.discount_amount || 0)) * ratio)
    const lineRefund = ri.refund_amount != null
      ? round2(Number(ri.refund_amount))
      : lineFair
    refundAmount = round2(refundAmount + lineRefund)
    fairRefund = round2(fairRefund + lineFair)
    returnLines.push({ orig, quantity: qty, refund: lineRefund })
  }

  if (input.refund_amount != null && input.refund_amount >= 0) {
    refundAmount = round2(input.refund_amount)
    if (refundAmount > fairRefund + 0.001) {
      throw createError({ statusCode: 400, message: `退款金额超出所选商品可退金额（最多 ¥${fairRefund.toFixed(2)}）` })
    }
  } else if (refundAmount > fairRefund + 0.001) {
    throw createError({ statusCode: 400, message: `退款金额超出所选商品可退金额（最多 ¥${fairRefund.toFixed(2)}）` })
  }

  const origPayable = Number(original.payable_amount) || 0
  const maxRefund = round2(Math.max(0, origPayable - priorRefunded))
  if (refundAmount > maxRefund + 0.001) {
    throw createError({ statusCode: 400, message: `退款金额超出剩余可退金额（最多 ¥${maxRefund.toFixed(2)}）` })
  }

  let refundCash = 0
  let refundBalance = 0
  let refundPointsValue = 0
  let refundPoints = 0

  if (origPayable > 0 && refundAmount > 0) {
    const refundRatio = Math.min(1, refundAmount / origPayable)
    const origPointsValue = Number(original.points_value) || 0
    const origBalance = Number(original.balance_amount) || 0
    let remaining = refundAmount

    if (origPointsValue > 0) {
      refundPointsValue = Math.min(round2(origPointsValue * refundRatio), remaining)
      remaining = round2(remaining - refundPointsValue)
      const settingsRow = await queryOne<any>('SELECT * FROM settings WHERE store_id = ?', [storeId])
      const redeemAmount = Number(settingsRow?.points_redeem_amount) || 100
      const redeemValue = Number(settingsRow?.points_redeem_value) || 1
      refundPoints = refundPointsValue > 0 ? Math.round(refundPointsValue / redeemValue * redeemAmount) : 0
    }
    if (origBalance > 0 && remaining > 0) {
      refundBalance = Math.min(round2(origBalance * refundRatio), remaining)
      remaining = round2(remaining - refundBalance)
    }
    refundCash = Math.max(0, Math.min(remaining, Number(original.cash_amount) || 0))
  } else {
    refundCash = Math.max(0, Math.min(refundAmount, Number(original.cash_amount) || 0))
  }

  // orders INSERT RETURNING
  let returnOrderId: number
  try {
    const orderRes = await execute(
      `INSERT INTO orders (store_id, type, member_id, original_order_id, total_amount, member_discount, order_discount, payable_amount, points_earned, cash_amount, balance_amount, points_amount, points_value, operator_id, idempotency_key, created_at)
       VALUES (?, 'return', ?, ?, ?, 0, 0, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours')) RETURNING id`,
      [storeId, original.member_id, originalOrderId, refundAmount, refundAmount, refundCash, refundBalance, refundPoints, refundPointsValue, operatorId, input.idempotency_key ?? null]
    )
    const head: any = orderRes
    returnOrderId = Number(head?.results?.[0]?.id ?? head?.meta?.last_row_id)
    if (!returnOrderId) throw createError({ statusCode: 500, message: '创建退货单失败' })
  } catch (err: any) {
    if (err.statusCode) throw err
    if (input.idempotency_key && isUniqueConflict(err)) {
      const reused = await findCompleteIdempotentReturn(storeId, input.idempotency_key, input.items.length)
      if (reused) return reused
    }
    throw err
  }

  let member: { id: number; balance: number; points: number; phone: string } | null = null
  let appliedSafeDeduct = 0

  // 第一阶段：order_items + 库存 UPDATE(RETURNING) + 会员 UPDATE(RETURNING)
  const stmts: { sql: string; params: any[] }[] = []

  for (const line of returnLines) {
    stmts.push({
      sql: `INSERT INTO order_items (order_id, product_id, product_name, product_unit, unit_price, original_price, quantity, base_quantity, base_unit, subtotal, discount_amount, cost_price, count_service_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))`,
      params: [
        returnOrderId,
        line.orig.product_id,
        line.orig.product_name,
        line.orig.product_unit,
        line.orig.unit_price,
        line.orig.original_price,
        line.quantity,
        line.quantity,
        line.orig.base_unit,
        line.refund,
        0,
        line.orig.cost_price,
        line.orig.count_service_id,
      ],
    })
  }

  const productReturns = new Map<number, number>()
  for (const line of returnLines) {
    if (line.orig.product_id && !line.orig.count_service_id) {
      productReturns.set(line.orig.product_id, (productReturns.get(line.orig.product_id) || 0) + line.quantity)
    }
  }

  const stockUpdateIdxs: number[] = []
  if (productReturns.size > 0) {
    const ids = [...productReturns.keys()]
    // D1 单条语句最多 100 绑定参数，按 50 切分
    const products: Array<{ id: number; stock_quantity: number }> = []
    for (let i = 0; i < ids.length; i += 50) {
      const group = ids.slice(i, i + 50)
      const placeholders = group.map(() => '?').join(',')
      const rows = await query<{ id: number; stock_quantity: number }>(
        `SELECT id, stock_quantity FROM products WHERE id IN (${placeholders})`,
        group
      )
      products.push(...rows)
    }
    for (const p of products) {
      const qty = productReturns.get(p.id) || 0
      stockUpdateIdxs.push(stmts.length)
      stmts.push({
        sql: 'UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? RETURNING stock_quantity',
        params: [qty, p.id],
      })
    }
  }

  let memberUpdateIdx = -1
  if (original.member_id && (refundBalance > 0 || refundPoints > 0 || (original.points_earned && original.points_earned > 0))) {
    member = await queryOne<{ id: number; balance: number; points: number; phone: string }>(
      'SELECT id, balance, points, phone FROM members WHERE id = ?',
      [original.member_id]
    )
    if (member) {
      const priorDeducted = await getPriorDeductedPoints(member.id, originalOrderId)
      const maxDeduct = Math.max(0, (original.points_earned || 0) - priorDeducted)
      const earnedPointsToDeduct = Math.min(
        maxDeduct,
        original.points_earned
          ? Math.round(original.points_earned * (origPayable > 0 ? Math.min(1, refundAmount / origPayable) : 0))
          : 0
      )
      // 防止退货后积分变负：若已扣减大于（当前积分 + 退还积分），则按剩余可扣减
      const safeDeduct = Math.min(earnedPointsToDeduct, Math.max(0, Number(member.points) + refundPoints))
      appliedSafeDeduct = safeDeduct
      memberUpdateIdx = stmts.length
      stmts.push({
        sql: 'UPDATE members SET balance = balance + ?, points = points + ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? RETURNING balance, points',
        params: [refundBalance, refundPoints - safeDeduct, member!.id],
      })
    }
  }

  try {
    let results: any[] = []
    if (stmts.length > 0) results = await batch(stmts)

    // 第二阶段：log INSERT，stock_after/balance_after 用 RETURNING 真实值
    const logStmts: { sql: string; params: any[] }[] = []

    if (productReturns.size > 0) {
      const ids = [...productReturns.keys()]
      for (let i = 0; i < ids.length; i++) {
        const productId = ids[i]
        const stockIdx = stockUpdateIdxs[i]
        const qty = productReturns.get(productId) || 0
        const ret = stockIdx >= 0 ? results[stockIdx]?.results?.[0] : null
        const actualStock = ret ? Number(ret.stock_quantity) : null
        logStmts.push({
          sql: `INSERT INTO product_stock_logs (product_id, store_id, type, quantity_change, stock_after, related_order_id, operator_id, created_at)
                VALUES (?, ?, '退货', ?, ?, ?, ?, datetime('now', '+8 hours'))`,
          params: [productId, storeId, qty, actualStock, returnOrderId, operatorId],
        })
      }
    }

    if (member && memberUpdateIdx >= 0) {
      const ret = results[memberUpdateIdx]?.results?.[0]
      const actualBalance = ret ? Number(ret.balance) : round2(Number(member.balance) + refundBalance)
      const actualPoints = ret ? Number(ret.points) : Number(member.points) + refundPoints
      if (refundBalance > 0) {
        logStmts.push({
          sql: `INSERT INTO balance_logs (member_id, store_id, type, amount, balance_after, related_order_id, operator_id, created_at)
                VALUES (?, ?, 'refund', ?, ?, ?, ?, datetime('now', '+8 hours'))`,
          params: [member.id, storeId, refundBalance, actualBalance, returnOrderId, operatorId],
        })
      }
      if (refundPoints > 0) {
        logStmts.push({
          sql: `INSERT INTO point_logs (member_id, store_id, type, amount, balance_after, related_order_id, operator_id, created_at)
                VALUES (?, ?, 'refund', ?, ?, ?, ?, datetime('now', '+8 hours'))`,
          params: [member.id, storeId, refundPoints, Number(member.points) + refundPoints, returnOrderId, operatorId],
        })
      }
      const realSafeDeduct = appliedSafeDeduct
      if (realSafeDeduct > 0) {
        const pointsAfterDeduct = actualPoints
        logStmts.push({
          sql: `INSERT INTO point_logs (member_id, store_id, type, amount, balance_after, related_order_id, operator_id, created_at)
                VALUES (?, ?, 'deduct', ?, ?, ?, ?, datetime('now', '+8 hours'))`,
          params: [member.id, storeId, realSafeDeduct, pointsAfterDeduct, returnOrderId, operatorId],
        })
      }
    }

    if (logStmts.length > 0) await batch(logStmts)
  } catch (err: any) {
    if (err.statusCode) throw err
    const compStmts: { sql: string; params: any[] }[] = [
      { sql: 'DELETE FROM order_items WHERE order_id = ?', params: [returnOrderId] },
      { sql: 'DELETE FROM product_stock_logs WHERE related_order_id = ?', params: [returnOrderId] },
      { sql: 'DELETE FROM balance_logs WHERE related_order_id = ?', params: [returnOrderId] },
      { sql: 'DELETE FROM point_logs WHERE related_order_id = ?', params: [returnOrderId] },
      { sql: 'DELETE FROM orders WHERE id = ?', params: [returnOrderId] },
    ]
    const committed = await queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM order_items WHERE order_id = ?', [returnOrderId]).catch(() => null)
    if (Number(committed?.c || 0) > 0) {
      if (productReturns.size > 0) {
        for (const [pid, qty] of productReturns) {
          compStmts.push({ sql: 'UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?', params: [qty, pid] })
        }
      }
      if (member) {
        compStmts.push({
          sql: 'UPDATE members SET balance = balance - ?, points = points - ? WHERE id = ?',
          params: [refundBalance, refundPoints - appliedSafeDeduct, member.id],
        })
      }
    }
    await batch(compStmts).catch(() => {})
    throw createError({ statusCode: 500, message: '退货单写入失败: ' + (err?.message || '未知错误') })
  }

  // dashboard 缓存仅靠 60s TTL（逐单失效会使营业时间缓存永不命中）

  if (member) {
    const tasks: Promise<void>[] = []
    if (refundBalance > 0) {
      tasks.push(notifyMember(storeId, member.phone, 'balance', {
        amount: round2(refundBalance).toFixed(2),
        balance: round2(Number(member.balance) + refundBalance).toFixed(2),
      }))
    }
    if (refundPoints > 0) {
      tasks.push(notifyMember(storeId, member.phone, 'points', {
        points: String(refundPoints),
        balance: String(Number(member.points) + refundPoints),
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

  return { return_order_id: returnOrderId, refund_amount: refundAmount }
}
