import { query, queryOne } from '../../utils/db'
import { requireAdmin } from '../../utils/auth'
import { BACKUP_TABLES } from '../../utils/backupTables'
import { buildRowsSql, buildTableSql } from '../../utils/backupExport'

const DEFAULT_PAGE_SIZE = 2000
const MAX_PAGE_SIZE = 5000

export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const q = getQuery(event)
  const table = String(q.table || '')
  if (!BACKUP_TABLES.includes(table)) throw createError({ statusCode: 400, message: '表名无效' })
  const offset = Math.max(0, Number(q.offset) || 0)
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(q.limit) || DEFAULT_PAGE_SIZE))

  const schema = await queryOne<{ sql: string }>(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
    [table]
  )
  if (!schema || !schema.sql) return { name: table, rows: 0, total: 0, offset, limit, done: true, sql: '' }

  const totalRow = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`)
  const total = Number(totalRow?.c || 0)
  const rows = await query<any>(`SELECT * FROM ${table} ORDER BY rowid LIMIT ? OFFSET ?`, [limit, offset])
  const firstPage = offset === 0
  const sql = firstPage
    ? buildTableSql(table, schema.sql, rows)
    : buildRowsSql(table, rows.length > 0 ? Object.keys(rows[0]) : [], rows)
  const done = offset + rows.length >= total
  return { name: table, rows: rows.length, total, offset, limit, done, sql }
})
