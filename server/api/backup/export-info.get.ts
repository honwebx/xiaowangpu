import { query, queryOne } from '../../utils/db'
import { requireAdmin } from '../../utils/auth'
import { BACKUP_TABLES, findUnbackedTables } from '../../utils/backupTables'
import { buildHead, buildTail } from '../../utils/backupExport'

export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const tableRows = await query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table'`
  )
  const existing = new Set(tableRows.map((r) => r.name))
  const orderedTables = BACKUP_TABLES.filter((t) => existing.has(t))

  const tables: Array<{ name: string; rows: number }> = []
  for (const table of orderedTables) {
    const c = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`)
    tables.push({ name: table, rows: Number(c?.c || 0) })
  }

  const generatedAt = new Date().toISOString()
  const indexes = await query<{ sql: string; tbl_name: string }>(
    `SELECT sql, tbl_name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL`
  )
  const allowedTables = new Set(orderedTables)

  return {
    generatedAt,
    tables,
    totalRows: tables.reduce((s, t) => s + t.rows, 0),
    unbackedTables: findUnbackedTables(tableRows.map((r) => r.name)),
    head: buildHead(generatedAt),
    tail: buildTail(indexes.filter((idx) => allowedTables.has(idx.tbl_name)).map((idx) => idx.sql)),
  }
})
