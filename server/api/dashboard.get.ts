import { query, queryOne, round2 } from '../utils/db'
import { resolveStoreId, getAuth } from '../utils/auth'
import { getCachedDashboardToday, setCachedDashboardToday, getCachedDashboardStatic, setCachedDashboardStatic, dashboardKey } from '../utils/cache'

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function beijingNowParts(): { year: number; month: number; day: number } {
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return { year: y, month: m, day: d }
}

function todayRange(bj: { year: number; month: number; day: number }): [string, string] {
  const pad = (n: number) => String(n).padStart(2, '0')
  const f = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)} 00:00:00`
  const t = new Date(Date.UTC(bj.year, bj.month - 1, bj.day + 1))
  return [f(bj.year, bj.month, bj.day), f(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())]
}

function last30DaysRange(bj: { year: number; month: number; day: number }): [string, string] {
  const pad = (n: number) => String(n).padStart(2, '0')
  const f = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} 00:00:00`
  const start = new Date(Date.UTC(bj.year, bj.month - 1, bj.day - 29))
  const end = new Date(Date.UTC(bj.year, bj.month - 1, bj.day + 1))
  return [f(start), f(end)]
}

function periodRange(year: number, month?: number): [string, string] {
  const pad = (n: number) => String(n).padStart(2, '0')
  const f = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)} 00:00:00`
  if (month) {
    const nm = new Date(Date.UTC(year, month, 1))
    return [f(year, month, 1), f(nm.getUTCFullYear(), nm.getUTCMonth() + 1, 1)]
  }
  return [f(year, 1, 1), f(year + 1, 1, 1)]
}

// point_logs 单表积分成本净值（未乘兑换系数）：订单关联 earn - deduct - redeem + max(0, 手动 earn - redeem)
const POINTS_NET_EXPR = `(
   COALESCE(SUM(CASE WHEN type='earn' AND related_order_id IS NOT NULL THEN amount ELSE 0 END),0)
   - COALESCE(SUM(CASE WHEN type='deduct' AND related_order_id IS NOT NULL THEN amount ELSE 0 END),0)
   - COALESCE(SUM(CASE WHEN type='redeem' AND related_order_id IS NOT NULL THEN amount ELSE 0 END),0)
   + CASE WHEN COALESCE(SUM(CASE WHEN type='earn' AND related_order_id IS NULL THEN amount ELSE 0 END),0)
            - COALESCE(SUM(CASE WHEN type='redeem' AND related_order_id IS NULL THEN amount ELSE 0 END),0) > 0
       THEN COALESCE(SUM(CASE WHEN type='earn' AND related_order_id IS NULL THEN amount ELSE 0 END),0)
            - COALESCE(SUM(CASE WHEN type='redeem' AND related_order_id IS NULL THEN amount ELSE 0 END),0)
       ELSE 0 END
 )`

type PeriodRanges = { today: [string, string]; month: [string, string]; year: [string, string] }

// 今日/本月/今年三段聚合并为一条 UNION ALL 查询，每段走 (store_id, created_at) 索引 range scan；
// month/year 段可从图表 GROUP BY 结果推导（同表达式），默认只查 today 段
function unionPeriods(sel: string, fromWhere: string, col: string, ranges: PeriodRanges, storeId: number, which: Array<'today' | 'month' | 'year'> = ['today', 'month', 'year']) {
  const params: any[] = []
  const sql = which
    .map((p) => {
      const [s, e] = ranges[p]
      params.push(storeId, s, e)
      return `SELECT '${p}' AS period, ${sel} ${fromWhere} AND ${col} >= ? AND ${col} < ?`
    })
    .join(' UNION ALL ')
  return { sql, params }
}

function byPeriod(rows: any[]): Record<string, any> {
  const m: Record<string, any> = {}
  for (const r of rows) m[r.period] = r
  return m
}

export default defineEventHandler(async (event) => {
  const auth = getAuth(event)
  const canSeeProfit = auth.role !== 'clerk'
  const q = getQuery(event)
  const storeId = resolveStoreId(event, (q.store_id as any) ?? null)
  if (!storeId) throw createError({ statusCode: 400, message: '请选择店铺' })
  const bj = beijingNowParts()
  const year = Number(q.year) || bj.year
  const monthProvided = q.month != null && q.month !== ''
  const month = monthProvided ? Number(q.month) : bj.month

  const ranges: PeriodRanges = {
    today: todayRange(bj),
    month: periodRange(year, month),
    year: periodRange(year),
  }

  interface PeriodRaw {
    sales: number; returns: number; cashNet: number; cnt: number
    margin: number; manualConsume: number; recharge: number
    countUsage: number; assignPaid: number; pointsCost: number; bonusCost: number
  }
  function computePeriod(r: PeriodRaw) {
    return {
      sales: round2(r.sales - r.returns + r.manualConsume + r.countUsage),
      returns: round2(r.returns),
      orders: r.cnt,
      income: round2(r.cashNet + r.recharge + r.assignPaid),
      profit: round2(r.margin),
      pointsCost: round2(r.pointsCost),
      bonusCost: round2(r.bonusCost),
    }
  }
  function rawFromUnion(o: any, p: any, c: any, m: any, pl: any, b: any): PeriodRaw {
    return {
      sales: Number(o.sales || 0),
      returns: Number(o.returns || 0),
      cashNet: Number(o.cash_in || 0) - Number(o.cash_out || 0),
      cnt: Number(o.cnt || 0),
      margin: Number(p.v || 0),
      manualConsume: Number(b.manual_consume || 0),
      recharge: Number(b.recharge || 0),
      countUsage: Number(c.v || 0),
      assignPaid: Number(m.v || 0),
      pointsCost: Number(pl.v || 0),
      bonusCost: Number(b.bonus_cost || 0),
    }
  }

  async function loadFactor(): Promise<number> {
    if (!canSeeProfit) return 0
    const settingsRow = await queryOne<{ points_redeem_value: number | null; points_redeem_amount: number | null }>(
      'SELECT points_redeem_value, points_redeem_amount FROM settings WHERE store_id = ?',
      [storeId]
    )
    const redeemValue = settingsRow?.points_redeem_value == null ? 1 : Number(settingsRow.points_redeem_value)
    const redeemAmount = settingsRow?.points_redeem_amount == null ? 100 : Number(settingsRow.points_redeem_amount)
    const pointsFactor = redeemAmount === 0 ? 0 : (redeemValue * 1.0) / redeemAmount
    return Number.isFinite(pointsFactor) ? pointsFactor : 0
  }

  async function loadPeriodMaps(which: Array<'today' | 'month' | 'year'>, factorSql: number) {
    const ordersAgg = unionPeriods(
      `COALESCE(SUM(CASE WHEN type='sale' THEN payable_amount ELSE 0 END),0) AS sales,
              COALESCE(SUM(CASE WHEN type='return' THEN payable_amount ELSE 0 END),0) AS returns,
              COALESCE(SUM(CASE WHEN type='sale' THEN cash_amount ELSE 0 END),0) AS cash_in,
              COALESCE(SUM(CASE WHEN type='return' THEN cash_amount ELSE 0 END),0) AS cash_out,
              COALESCE(SUM(CASE WHEN type='sale' THEN 1 ELSE 0 END),0) AS cnt`,
      'FROM orders WHERE store_id = ?', 'created_at', ranges, storeId, which)
    const profitAgg = canSeeProfit ? unionPeriods(
      `COALESCE(SUM(CASE
          WHEN o.type='sale' THEN (oi.subtotal - COALESCE(oi.discount_amount,0)) - COALESCE(oi.cost_price,0)*COALESCE(oi.base_quantity, oi.quantity)
          WHEN o.type='return' THEN COALESCE(oi.cost_price,0)*COALESCE(oi.base_quantity, oi.quantity) - (oi.subtotal - COALESCE(oi.discount_amount,0))
          ELSE 0 END),0) AS v`,
      'FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.store_id = ?', 'o.created_at', ranges, storeId, which)
      : null
    const culAgg = unionPeriods(
      'COALESCE(SUM(unit_amount),0) AS v',
      'FROM count_usage_logs WHERE store_id = ?', 'created_at', ranges, storeId, which)
    const mcsAgg = unionPeriods(
      'COALESCE(SUM(paid_amount),0) AS v',
      'FROM member_count_services WHERE store_id = ?', 'purchased_at', ranges, storeId, which)
    const plAgg = canSeeProfit ? unionPeriods(
      `COALESCE(${POINTS_NET_EXPR},0) * ${factorSql} AS v`,
      'FROM point_logs WHERE store_id = ?', 'created_at', ranges, storeId, which)
      : null
    const blAgg = unionPeriods(
      `COALESCE(SUM(CASE WHEN type='consume' AND related_order_id IS NULL THEN amount ELSE 0 END),0) AS manual_consume,
              COALESCE(SUM(CASE WHEN type='recharge' THEN amount ELSE 0 END),0) AS recharge,
              COALESCE(SUM(CASE WHEN type='recharge' THEN bonus_amount ELSE 0 END),0) AS bonus_cost`,
      'FROM balance_logs WHERE store_id = ?', 'created_at', ranges, storeId, which)

    const [ordersRows, profitRows, culRows, mcsRows, plRows, blRows] = await Promise.all([
      query<any>(ordersAgg.sql, ordersAgg.params),
      profitAgg ? query<any>(profitAgg.sql, profitAgg.params) : Promise.resolve([]),
      query<any>(culAgg.sql, culAgg.params),
      query<any>(mcsAgg.sql, mcsAgg.params),
      plAgg ? query<any>(plAgg.sql, plAgg.params) : Promise.resolve([]),
      query<any>(blAgg.sql, blAgg.params),
    ])
    return {
      O: byPeriod(ordersRows),
      P: byPeriod(profitRows),
      C: byPeriod(culRows),
      M: byPeriod(mcsRows),
      PL: byPeriod(plRows),
      B: byPeriod(blRows),
    }
  }
  type PeriodMaps = Awaited<ReturnType<typeof loadPeriodMaps>>
  function buildPeriod(maps: PeriodMaps, k: 'today' | 'month' | 'year') {
    return computePeriod(rawFromUnion(maps.O[k] || {}, maps.P[k] || {}, maps.C[k] || {}, maps.M[k] || {}, maps.PL[k] || {}, maps.B[k] || {}))
  }

  function respond(today: any, st: any) {
    const maskPeriod = (p: any) =>
      canSeeProfit ? p : { ...p, profit: null, pointsCost: null, bonusCost: null }
    return {
      today: maskPeriod(today),
      month: maskPeriod(st.month),
      year: maskPeriod(st.year),
      chart: {
        mode: monthProvided ? 'daily' : 'monthly',
        labels: st.labels,
        sales: st.sales,
        returns: st.returns,
        profit: canSeeProfit ? st.profit : [],
        income: st.income,
      },
      topProducts: st.topProducts,
      stockAlerts: st.stockAlerts,
    }
  }

  const cacheKey = dashboardKey(storeId, year, monthProvided, month)
  const staticCached = getCachedDashboardStatic(cacheKey) as any
  if (staticCached) {
    const todayCached = getCachedDashboardToday(storeId)
    if (todayCached) return respond(todayCached, staticCached)
    const factorSql = await loadFactor()
    const maps = await loadPeriodMaps(['today'], factorSql)
    const today = buildPeriod(maps, 'today')
    if (canSeeProfit) setCachedDashboardToday(storeId, today)
    return respond(today, staticCached)
  }

  const factorSql = await loadFactor()
  const periodWhich: Array<'today' | 'month' | 'year'> = monthProvided ? ['today', 'year'] : ['today']
  const maps = await loadPeriodMaps(periodWhich, factorSql)
  const today = buildPeriod(maps, 'today')

  const chartRange = monthProvided ? periodRange(year, month) : periodRange(year)
  const chartClause = (col: string) => `${col} >= ? AND ${col} < ?`
  const chartParams = chartRange
  const chartKey = (col: string) => monthProvided
    ? `CAST(strftime('%d', ${col}) AS INTEGER)`
    : `CAST(strftime('%m', ${col}) AS INTEGER)`
  const chartLen = monthProvided ? daysInMonth(year, month) : 12
  const labels = monthProvided
    ? Array.from({ length: chartLen }, (_, i) => `${month}-${i + 1}`)
    : Array.from({ length: chartLen }, (_, i) => `${i + 1}月`)

  // 销售排行固定统计近30天滚动（含今日，避免月初自然月空榜；与图表区间解耦）
  const topPeriodRange = last30DaysRange(bj)
  const [ordersGrp, profitGrp, countGrp, assignGrp, pointsGrp, balanceChartRow, topProducts, stockAlerts] = await Promise.all([
    query<{ k: number; sales: number; returns: number; cash_in: number; cash_out: number; cnt: number }>(
      `SELECT ${chartKey('o.created_at')} AS k,
              COALESCE(SUM(CASE WHEN o.type='sale' THEN o.payable_amount ELSE 0 END),0) AS sales,
              COALESCE(SUM(CASE WHEN o.type='return' THEN o.payable_amount ELSE 0 END),0) AS returns,
              COALESCE(SUM(CASE WHEN o.type='sale' THEN o.cash_amount ELSE 0 END),0) AS cash_in,
              COALESCE(SUM(CASE WHEN o.type='return' THEN o.cash_amount ELSE 0 END),0) AS cash_out,
              COALESCE(SUM(CASE WHEN o.type='sale' THEN 1 ELSE 0 END),0) AS cnt
         FROM orders o
        WHERE o.store_id = ? AND ${chartClause('o.created_at')}
        GROUP BY k`,
      [storeId, ...chartParams]
    ),
    canSeeProfit ? query<{ k: number; v: number }>(
      `SELECT ${chartKey('o.created_at')} AS k,
              COALESCE(SUM(CASE
                WHEN o.type='sale' THEN (oi.subtotal - COALESCE(oi.discount_amount,0)) - COALESCE(oi.cost_price,0)*COALESCE(oi.base_quantity, oi.quantity)
                WHEN o.type='return' THEN COALESCE(oi.cost_price,0)*COALESCE(oi.base_quantity, oi.quantity) - (oi.subtotal - COALESCE(oi.discount_amount,0))
                ELSE 0 END),0) AS v
         FROM orders o JOIN order_items oi ON oi.order_id=o.id
         WHERE o.store_id = ? AND ${chartClause('o.created_at')}
         GROUP BY k`,
      [storeId, ...chartParams]
    ) : Promise.resolve([]),
    query<{ k: number; v: number }>(
      `SELECT ${chartKey('created_at')} AS k, COALESCE(SUM(unit_amount),0) AS v
         FROM count_usage_logs
        WHERE store_id = ? AND ${chartClause('created_at')}
        GROUP BY k`,
      [storeId, ...chartParams]
    ),
    query<{ k: number; v: number }>(
      `SELECT ${chartKey('purchased_at')} AS k, COALESCE(SUM(paid_amount),0) AS v
         FROM member_count_services
        WHERE store_id = ? AND ${chartClause('purchased_at')}
        GROUP BY k`,
      [storeId, ...chartParams]
    ),
    canSeeProfit ? query<{ k: number; v: number }>(
      `SELECT ${chartKey('created_at')} AS k, COALESCE(${POINTS_NET_EXPR},0) * ${factorSql} AS v
         FROM point_logs
        WHERE store_id = ? AND ${chartClause('created_at')}
        GROUP BY k`,
      [storeId, ...chartParams]
    ) : Promise.resolve([]),
    query<{ k: number; manual_consume: number; recharge: number; bonus_cost: number }>(
      `SELECT ${chartKey('created_at')} AS k,
              COALESCE(SUM(CASE WHEN type='consume' AND related_order_id IS NULL THEN amount ELSE 0 END),0) AS manual_consume,
              COALESCE(SUM(CASE WHEN type='recharge' THEN amount ELSE 0 END),0) AS recharge,
              COALESCE(SUM(CASE WHEN type='recharge' THEN bonus_amount ELSE 0 END),0) AS bonus_cost
         FROM balance_logs
        WHERE store_id = ? AND ${chartClause('created_at')}
        GROUP BY k`,
      [storeId, ...chartParams]
    ),
    query<any>(
      `SELECT p.id, p.name, p.primary_unit,
              COALESCE(SUM(CASE
                WHEN o.type='sale' THEN COALESCE(oi.base_quantity, oi.quantity)
                WHEN o.type='return' THEN -COALESCE(oi.base_quantity, oi.quantity)
                ELSE 0 END),0) AS qty,
              COALESCE(SUM(CASE
                WHEN o.type='sale' THEN oi.subtotal - COALESCE(oi.discount_amount,0)
                WHEN o.type='return' THEN -(oi.subtotal - COALESCE(oi.discount_amount,0))
                ELSE 0 END),0) AS amount
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN products p ON p.id = oi.product_id
        WHERE o.store_id = ? AND o.created_at >= ? AND o.created_at < ?
        GROUP BY p.id, p.name, p.primary_unit
        ORDER BY qty DESC
        LIMIT 10`,
      [storeId, ...topPeriodRange]
    ),
    query<any>(
      `SELECT id, name, stock_quantity, stock_alert, primary_unit
         FROM products
        WHERE store_id = ? AND status='active' AND stock_alert > 0 AND stock_quantity <= stock_alert
        ORDER BY (stock_quantity - stock_alert) ASC
        LIMIT 20`,
      [storeId]
    ),
  ])

  const returnsMap = new Map<number, number>()
  const netSales = new Map<number, number>()
  const netCash = new Map<number, number>()
  const salesRawMap = new Map<number, number>()
  const cntMap = new Map<number, number>()
  for (const r of ordersGrp) {
    netSales.set(Number(r.k), Number(r.sales || 0) - Number(r.returns || 0))
    netCash.set(Number(r.k), Number(r.cash_in || 0) - Number(r.cash_out || 0))
    returnsMap.set(Number(r.k), Number(r.returns || 0))
    salesRawMap.set(Number(r.k), Number(r.sales || 0))
    cntMap.set(Number(r.k), Number(r.cnt || 0))
  }
  const marginMap = new Map<number, number>()
  for (const r of profitGrp) marginMap.set(Number(r.k), Number(r.v || 0))
  const countMap = new Map<number, number>()
  for (const r of countGrp) countMap.set(Number(r.k), Number(r.v || 0))
  const assignMap = new Map<number, number>()
  for (const r of assignGrp) assignMap.set(Number(r.k), Number(r.v || 0))
  const pointsCostMap = new Map<number, number>()
  for (const r of pointsGrp) pointsCostMap.set(Number(r.k), Number(r.v || 0))
  const manualConsumeMap = new Map<number, number>()
  const rechargeMap = new Map<number, number>()
  const bonusCostMap = new Map<number, number>()
  for (const r of balanceChartRow) {
    manualConsumeMap.set(Number(r.k), Number(r.manual_consume || 0))
    rechargeMap.set(Number(r.k), Number(r.recharge || 0))
    bonusCostMap.set(Number(r.k), Number(r.bonus_cost || 0))
  }

  const salesArr: number[] = []
  const returnsArr: number[] = []
  const profitArr: number[] = []
  const incomeArr: number[] = []
  for (let i = 1; i <= chartLen; i++) {
    const ns = netSales.get(i) || 0
    const mc = manualConsumeMap.get(i) || 0
    const cu = countMap.get(i) || 0
    const nc = netCash.get(i) || 0
    const rg = rechargeMap.get(i) || 0
    const ap = assignMap.get(i) || 0
    const mg = marginMap.get(i) || 0
    salesArr.push(round2(ns + mc + cu))
    returnsArr.push(round2(returnsMap.get(i) || 0))
    profitArr.push(round2(mg))
    incomeArr.push(round2(nc + rg + ap))
  }

  // month/year 卡片从图表 bucket 求和推导（与 UNION 臂同表达式，原始值求和后舍入一次）；
  // monthProvided 模式图表仅覆盖单月，year 卡片仍用 year 臂；today 卡片始终用 today 臂
  function rawFromBuckets(idxs: number[]): PeriodRaw {
    let sales = 0, returns = 0, cashNet = 0, cnt = 0
    let margin = 0, mc = 0, rg = 0, cu = 0, ap = 0, pc = 0, bc = 0
    for (const i of idxs) {
      sales += (salesRawMap.get(i) || 0)
      returns += (returnsMap.get(i) || 0)
      cashNet += netCash.get(i) || 0
      cnt += cntMap.get(i) || 0
      margin += marginMap.get(i) || 0
      mc += manualConsumeMap.get(i) || 0
      rg += rechargeMap.get(i) || 0
      cu += countMap.get(i) || 0
      ap += assignMap.get(i) || 0
      pc += pointsCostMap.get(i) || 0
      bc += bonusCostMap.get(i) || 0
    }
    return {
      sales, returns, cashNet, cnt, margin,
      manualConsume: mc, recharge: rg, countUsage: cu, assignPaid: ap, pointsCost: pc, bonusCost: bc,
    }
  }
  const allIdx = Array.from({ length: chartLen }, (_, i) => i + 1)
  const monthData = monthProvided
    ? computePeriod(rawFromBuckets(allIdx))
    : computePeriod(rawFromBuckets([month]))
  const yearData = monthProvided
    ? buildPeriod(maps, 'year')
    : computePeriod(rawFromBuckets(allIdx))

  const staticCacheable = {
    month: monthData,
    year: yearData,
    labels,
    sales: salesArr,
    returns: returnsArr,
    profit: profitArr,
    income: incomeArr,
    topProducts,
    stockAlerts,
  }
  // clerk 不写缓存：其 profit/points 为空，写入会污染 admin 可见的缓存条目
  if (canSeeProfit) {
    setCachedDashboardStatic(cacheKey, staticCacheable)
    setCachedDashboardToday(storeId, today)
  }

  return respond(today, staticCacheable)
})
