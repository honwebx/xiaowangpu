import { query } from '../../utils/db'
import { resolveStoreId } from '../../utils/auth'

function escapeHtml(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const storeId = resolveStoreId(event, (q.store_id as any) ?? null)
  if (!storeId) throw createError({ statusCode: 400, message: '缺少店铺' })

  const products = await query<any>(
    `SELECT id, name, short_code, primary_unit, stock_quantity
       FROM products WHERE store_id = ? AND stock_quantity > 0 ORDER BY name LIMIT 5000`,
    [storeId]
  )

  const dateStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 10)
  const truncated = products.length >= 5000

  const rows = products.map((p: any, i: number) => `
    <tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.short_code)}</td>
      <td style="text-align:center">${escapeHtml(p.primary_unit)}</td>
      <td style="text-align:center">${escapeHtml(p.stock_quantity)}</td>
      <td style="width:80px"></td>
    </tr>`).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>库存盘点表</title>
<style>
@page { size: A4 portrait; margin: 12pt; }
* { margin: 0; padding: 0; }
body { color: #000; font: 12pt "Microsoft YaHei", "PingFang SC", sans-serif; line-height: 1.2; }
.header { text-align: center; margin-bottom: 16px; }
.header h1 { font-size: 18pt; margin-bottom: 4px; }
.header .info { font-size: 10pt; color: #666; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #000; padding: .3em .5em; font-size: 10pt; }
th { background: #169C91; color: #fff; font-weight: bold; }
td { text-align: left; }
tr:nth-child(even) { background: #f7f9fa; }
.footer { margin-top: 30pt; display: flex; justify-content: space-between; font-size: 10pt; color: #666; }
@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<div class="header">
<h1>库存盘点表</h1>
<div class="info">日期: ${dateStr} | 商品数量: ${products.length}${truncated ? '（仅显示前5000条）' : ''}</div>
</div>
<table>
<thead><tr>
<th style="width:40px">序号</th>
<th>商品名称</th>
<th style="width:80px">助记码</th>
<th style="width:50px">单位</th>
<th style="width:70px">系统库存</th>
<th style="width:80px">实盘数量</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>
<div class="footer">
<span>盘点人: ______________</span>
<span>日期: ______________</span>
</div>
</body></html>`

  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  return html
})