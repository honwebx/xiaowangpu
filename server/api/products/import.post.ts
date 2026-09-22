import { query, queryOne, batch } from '../../utils/db'
import { requireManagerUp, ensureStoreAccess } from '../../utils/auth'
import { pinyinInitials } from '../../utils/shortcode'
import { prefixLike } from '../../utils/like'
import { isUniqueConflict } from '../../utils/idempotency'

interface ExistingRow {
  id: number
  barcode: string | null
  short_code: string
  stock_quantity: number
}

interface InsertRow {
  rowNos: number[]
  name: string
  shortCode: string
  barcode: string | null
  primaryUnit: string
  sellingPrice: number
  secondaryUnit: string | null
  conversionRate: number | null
  secondaryPrice: number | null
  costPrice: number | null
  discountVal: number
  stockQty: number
  stockAlert: number
  status: string
}

const CHUNK = 40
const MAX_ROWS = 2000

function rowNumber(v: any, field: string, allowEmpty = false): number | null {
  if (v == null || v === '') {
    if (allowEmpty) return null
    throw new Error(`${field}无效`)
  }
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field}必须为非负数字`)
  return n
}

function friendlyImportError(err: any): string {
  if (isUniqueConflict(err)) {
    const msg = String(err?.message || '')
    if (/barcode/i.test(msg)) return '条码已存在'
    if (/short_code/i.test(msg)) return '助记码已存在'
    return '商品已存在，请勿重复提交'
  }
  return err?.message || '导入失败'
}

export default defineEventHandler(async (event) => {
  const auth = requireManagerUp(event)
  const body = await readBody(event)
  const storeId = Number(body?.store_id)
  if (!storeId) throw createError({ statusCode: 400, message: '缺少店铺' })
  ensureStoreAccess(event, storeId)

  const overwrite = !!body?.overwrite
  const dryRun = !!body?.dry_run
  const idempotencyKey = body?.idempotency_key ? String(body.idempotency_key).slice(0, 64) : undefined
  const logKey = (suffix: string) => (idempotencyKey ? `${idempotencyKey}:${suffix}`.slice(0, 128) : null)

  if (idempotencyKey && !dryRun) {
    const dup = await queryOne<{ c: number }>(
      'SELECT COUNT(*) AS c FROM product_stock_logs WHERE store_id = ? AND idempotency_key LIKE ? ESCAPE \'\\\'',
      [storeId, prefixLike(idempotencyKey + ':')]
    )
    if (Number(dup?.c || 0) > 0) {
      throw createError({ statusCode: 409, message: '该批次已导入，请检查流水后勿重复提交' })
    }
  }

  let defaultAlert = 10
  const settings = await queryOne<{ default_stock_alert: number }>('SELECT default_stock_alert FROM settings WHERE store_id = ?', [storeId])
  if (settings && settings.default_stock_alert != null) {
    defaultAlert = Number(settings.default_stock_alert)
  }

  const items = Array.isArray(body?.products) ? body.products : []
  if (items.length === 0) throw createError({ statusCode: 400, message: '没有可导入的商品' })
  if (items.length > MAX_ROWS) throw createError({ statusCode: 400, message: `单次最多导入 ${MAX_ROWS} 条` })

  const allRows = await query<ExistingRow>(
    `SELECT id, barcode, short_code, stock_quantity FROM products WHERE store_id = ?`,
    [storeId]
  )
  const byBarcode = new Map<string, ExistingRow>()
  const byShortCode = new Map<string, ExistingRow>()
  for (const r of allRows) {
    if (r.barcode) byBarcode.set(r.barcode, r)
    byShortCode.set(r.short_code, r)
  }

  const resolvedShortCodes: string[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {}
    const name = String(it.name || '').trim()
    let shortCode = String(it.short_code || '').trim().toUpperCase()
    if (!shortCode) {
      shortCode = await pinyinInitials(name)
    }
    resolvedShortCodes.push(shortCode)
  }

  if (dryRun) {
    const existingItems: Array<{ row: number; name: string; matched_by: string }> = []
    const seenBarcode = new Set<string>()
    const seenShortCode = new Set<string>()
    let newCount = 0
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {}
      const rowNo = i + 2
      const name = String(it.name || '').trim()
      const barcode = String(it.barcode || '').trim() || null
      const shortCode = resolvedShortCodes[i]
      let matchedBy = ''
      if (barcode && byBarcode.has(barcode)) {
        matchedBy = 'barcode'
      } else if (byShortCode.has(shortCode)) {
        matchedBy = 'short_code'
      } else if ((barcode && seenBarcode.has(barcode)) || seenShortCode.has(shortCode)) {
        matchedBy = '导入文件内重复'
      }
      if (matchedBy) existingItems.push({ row: rowNo, name, matched_by: matchedBy })
      else newCount += 1
      if (barcode) seenBarcode.add(barcode)
      seenShortCode.add(shortCode)
    }
    return { dry_run: true, total: items.length, existing_count: existingItems.length, new_count: newCount, existing_items: existingItems }
  }

  let success = 0
  let failed = 0
  const errors: Array<{ row: number; name: string; message: string }> = []

  const singleInsert = async (r: InsertRow) => {
    const stmts: { sql: string; params: any[] }[] = [{
      sql: `INSERT INTO products (store_id, name, short_code, barcode, primary_unit, selling_price,
          secondary_unit, conversion_rate, secondary_price, cost_price, discountable, stock_quantity, stock_alert, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))`,
      params: [storeId, r.name, r.shortCode, r.barcode, r.primaryUnit, r.sellingPrice,
        r.secondaryUnit, r.conversionRate, r.secondaryPrice, r.costPrice, r.discountVal, r.stockQty, r.stockAlert, r.status],
    }]
    if (r.stockQty > 0) {
      stmts.push({
        sql: `INSERT INTO product_stock_logs (product_id, store_id, type, quantity_change, stock_after, cost_price, notes, operator_id, idempotency_key, created_at)
              SELECT id, ?, '入库', ?, ?, ?, '导入入库', ?, ?, datetime('now', '+8 hours') FROM products WHERE store_id = ? AND short_code = ?`,
        params: [storeId, r.stockQty, r.stockQty, r.costPrice, auth.userId, logKey(r.shortCode), storeId, r.shortCode],
      })
    }
    try {
      await batch(stmts)
    } catch (err: any) {
      throw new Error(friendlyImportError(err))
    }
  }

  // 每 CHUNK 行一轮：行内纯内存校验/分类（写库延后），再合并为一条多行 INSERT + 一批 UPDATE 单次 batch 提交
  for (let c = 0; c < items.length; c += CHUNK) {
    const insertRows: InsertRow[] = []
    const updateRows: Array<{ rowNo: number; name: string; stmts: { sql: string; params: any[] }[] }> = []

    for (let i = c; i < Math.min(c + CHUNK, items.length); i++) {
      const it = items[i] || {}
      const rowNo = i + 2
      const name = String(it.name || '').trim()
      try {
        if (!name) throw new Error('商品名称不能为空')
        const primaryUnit = String(it.primary_unit || '件').trim()
        const barcode = String(it.barcode || '').trim() || null
        const rawShortCode = String(it.short_code || '').trim().toUpperCase()
        const shortCode = rawShortCode || resolvedShortCodes[i]
        const stockQty = it.stock_quantity == null || it.stock_quantity === ''
          ? 0
          : rowNumber(it.stock_quantity, '库存') ?? 0
        const costPrice = rowNumber(it.cost_price, '成本价', true)
        const conversionRate = rowNumber(it.conversion_rate, '换算率', true)
        if (conversionRate === 0) throw new Error('换算率不能为0')
        const secondaryPrice = rowNumber(it.secondary_price, '副单位售价', true)
        const secondaryUnit = String(it.secondary_unit || '').trim() || null
        if (secondaryUnit && conversionRate == null) throw new Error('填写副单位时换算率必填')
        const stockAlertRaw = rowNumber(it.stock_alert, '库存预警', true)

        let existing: ExistingRow | null = null
        if (barcode && byBarcode.has(barcode)) {
          existing = byBarcode.get(barcode)!
        } else if (byShortCode.has(shortCode)) {
          existing = byShortCode.get(shortCode)!
        }
        if (existing && existing.id === 0 && existing.short_code !== shortCode) {
          throw new Error('同批次内条码重复但助记码不同，请检查')
        }

        if (existing) {
          const newStock = Number(existing.stock_quantity) + stockQty
          const where = existing.id
            ? { sql: 'WHERE id = ?', params: [existing.id] }
            : { sql: 'WHERE store_id = ? AND short_code = ?', params: [storeId, existing.short_code] }
          const logIdKey = logKey(`u${existing.id || existing.short_code}`)
          const stmts: { sql: string; params: any[] }[] = [{
            sql: `UPDATE products SET stock_quantity = stock_quantity + ? ${where.sql}`,
            params: [stockQty, ...where.params],
          }]
          if (stockQty > 0) {
            stmts.push({
              sql: `INSERT INTO product_stock_logs (product_id, store_id, type, quantity_change, stock_after, cost_price, notes, operator_id, idempotency_key, created_at)
                    SELECT id, ?, '入库', ?, ?, ?, '导入增加库存', ?, ?, datetime('now', '+8 hours') FROM products ${where.sql}`,
              params: [storeId, stockQty, newStock, costPrice, auth.userId, logIdKey, ...where.params],
            })
          }

          if (overwrite) {
            const fields: string[] = []
            const fieldParams: any[] = []
            const setIfNonEmpty = (key: string, val: any, transform: (v: any) => any = (v) => v) => {
              if (val != null && val !== '') {
                fields.push(`${key} = ?`)
                fieldParams.push(transform(val))
              }
            }
            setIfNonEmpty('name', name)
            setIfNonEmpty('barcode', barcode, (v) => v || null)
            setIfNonEmpty('primary_unit', primaryUnit)
            setIfNonEmpty('secondary_unit', it.secondary_unit, (v) => String(v).trim() || null)
            if (it.conversion_rate != null && it.conversion_rate !== '') {
              fields.push('conversion_rate = ?')
              fieldParams.push(conversionRate)
            }
            if (it.secondary_price != null && it.secondary_price !== '') {
              fields.push('secondary_price = ?')
              fieldParams.push(secondaryPrice)
            }
            if (it.cost_price != null && it.cost_price !== '') {
              fields.push('cost_price = ?')
              fieldParams.push(costPrice)
            }
            if (it.stock_alert != null && it.stock_alert !== '') {
              fields.push('stock_alert = ?')
              fieldParams.push(stockAlertRaw)
            }

            const sp = it.selling_price
            if (sp != null && sp !== '') {
              fields.push('selling_price = ?')
              fieldParams.push(rowNumber(sp, '售价'))
            }

            const discountable = String(it.discountable || '').trim()
            if (discountable) {
              const discountVal = (discountable === '否' || discountable === '0' || discountable === 'false') ? 0 : 1
              fields.push('discountable = ?')
              fieldParams.push(discountVal)
            }

            const statusRaw = String(it.status || '').trim()
            if (statusRaw) {
              fields.push('status = ?')
              fieldParams.push(statusRaw === '下架' ? 'inactive' : 'active')
            }

            if (rawShortCode) {
              const dup = byShortCode.get(rawShortCode)
              if (!dup || dup.id === existing.id) {
                fields.push('short_code = ?')
                fieldParams.push(rawShortCode)
              }
            }

            if (fields.length) {
              fields.push("updated_at = datetime('now', '+8 hours')")
              stmts.push({ sql: `UPDATE products SET ${fields.join(', ')} ${where.sql}`, params: [...fieldParams, ...where.params] })
            }
          }

          updateRows.push({ rowNo, name, stmts })
          if (overwrite) {
            if (barcode) byBarcode.set(barcode, existing)
            byShortCode.set(shortCode, existing)
          }
          existing.stock_quantity = newStock
          continue
        }

        const sellingPrice = rowNumber(it.selling_price, '售价')
        if (sellingPrice == null) throw new Error('售价无效')

        const discountable = String(it.discountable || '').trim()
        let discountVal = 1
        if (discountable === '否' || discountable === '0' || discountable === 'false') discountVal = 0

        const stockAlert = stockAlertRaw ?? defaultAlert

        const dupInsert = insertRows.find((r) => r.shortCode === shortCode)
        if (dupInsert) {
          if (dupInsert.barcode && barcode && dupInsert.barcode !== barcode) {
            throw new Error('同批次内助记码重复但条码不同，请检查')
          }
          dupInsert.rowNos.push(rowNo)
          dupInsert.stockQty += stockQty
          if (overwrite) {
            if (barcode && !dupInsert.barcode) dupInsert.barcode = barcode
            if (secondaryUnit) dupInsert.secondaryUnit = secondaryUnit
            if (conversionRate != null) dupInsert.conversionRate = conversionRate
            if (secondaryPrice != null) dupInsert.secondaryPrice = secondaryPrice
            if (costPrice != null) dupInsert.costPrice = costPrice
            if (stockAlertRaw != null) dupInsert.stockAlert = stockAlertRaw
            if (it.selling_price != null && it.selling_price !== '') {
              dupInsert.sellingPrice = sellingPrice
            }
            if (discountable) dupInsert.discountVal = discountVal
            const statusRaw = String(it.status || '').trim()
            if (statusRaw) dupInsert.status = statusRaw === '下架' ? 'inactive' : 'active'
          }
          continue
        }

        const insertRow: InsertRow = {
          rowNos: [rowNo],
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
          status: String(it.status || '上架').trim() === '下架' ? 'inactive' : 'active',
        }
        insertRows.push(insertRow)
        // 模拟新增：入 Map（id=0 标记未落库，后续同行命中时 WHERE 改用 short_code 定位）
        const sim: ExistingRow = { id: 0, barcode, short_code: shortCode, stock_quantity: stockQty }
        if (barcode) byBarcode.set(barcode, sim)
        byShortCode.set(shortCode, sim)
      } catch (err: any) {
        failed += 1
        errors.push({ row: rowNo, name, message: friendlyImportError(err) })
      }
    }

    const groupSuccess =
      updateRows.length + insertRows.reduce((a, r) => a + r.rowNos.length, 0)
    if (groupSuccess === 0) continue

    const stmts: { sql: string; params: any[] }[] = []
    // D1 单条语句最多 100 个绑定参数：products 行 14 参数→每语句≤7 行，stock CTE 行 4 参数→每语句≤25 行
    const splitRows = <T>(rows: T[], per: number): T[][] => {
      const out: T[][] = []
      for (let i = 0; i < rows.length; i += per) out.push(rows.slice(i, i + per))
      return out
    }
    if (insertRows.length > 0) {
      for (const group of splitRows(insertRows, 7)) {
        const placeholders = group.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))`).join(', ')
        stmts.push({
          sql: `INSERT INTO products (store_id, name, short_code, barcode, primary_unit, selling_price,
              secondary_unit, conversion_rate, secondary_price, cost_price, discountable, stock_quantity, stock_alert, status, created_at, updated_at)
              VALUES ${placeholders}`,
          params: group.flatMap((r) => [
            storeId, r.name, r.shortCode, r.barcode, r.primaryUnit, r.sellingPrice,
            r.secondaryUnit, r.conversionRate, r.secondaryPrice, r.costPrice, r.discountVal, r.stockQty, r.stockAlert, r.status,
          ]),
        })
      }
      const withStock = insertRows.filter((r) => r.stockQty > 0)
      for (const group of splitRows(withStock, 25)) {
        stmts.push({
          sql: `WITH v(sc, qty, cost, ikey) AS (VALUES ${group.map(() => '(?, ?, ?, ?)').join(', ')})
                INSERT INTO product_stock_logs (product_id, store_id, type, quantity_change, stock_after, cost_price, notes, operator_id, idempotency_key, created_at)
                SELECT p.id, ?, '入库', v.qty, p.stock_quantity, v.cost, '导入入库', ?, v.ikey, datetime('now', '+8 hours')
                  FROM v
                  JOIN products p ON p.store_id = ? AND p.short_code = v.sc
                 WHERE v.qty > 0`,
          params: [storeId, auth.userId, ...group.flatMap((r) => [r.shortCode, r.stockQty, r.costPrice, logKey(r.shortCode)]), storeId],
        })
      }
    }
    for (const u of updateRows) stmts.push(...u.stmts)

    try {
      await batch(stmts)
      success += groupSuccess
    } catch (err: any) {
      if (idempotencyKey && /idempotency/i.test(String(err?.message || ''))) {
        throw createError({ statusCode: 409, message: '该批次已导入，请检查流水后勿重复提交' })
      }
      // 整组失败（batch 原子回滚）→ 逐行重放，保留逐行错误归因；
      // 重放限 30 次调用以内（防 subrequest 超限），超出部分标记后请用户修正重导
      const markSkipped = (rowNos: number[], name: string) => {
        failed += rowNos.length
        for (const rowNo of rowNos) errors.push({ row: rowNo, name, message: '同组失败行数过多未重放，请修正后重新导入' })
      }
      let replayCalls = 0
      for (const r of insertRows) {
        if (replayCalls >= 15) { markSkipped(r.rowNos, r.name); continue }
        replayCalls += 1
        try {
          await singleInsert(r)
          success += r.rowNos.length
        } catch (err: any) {
          failed += r.rowNos.length
          for (const rowNo of r.rowNos) errors.push({ row: rowNo, name: r.name, message: err?.message || '导入失败' })
        }
      }
      for (const u of updateRows) {
        if (replayCalls >= 30) { markSkipped([u.rowNo], u.name); continue }
        replayCalls += 1
        try {
          await batch(u.stmts)
          success += 1
        } catch (err: any) {
          failed += 1
          errors.push({ row: u.rowNo, name: u.name, message: friendlyImportError(err) })
        }
      }
    }
  }

  return { success, failed, errors }
})
