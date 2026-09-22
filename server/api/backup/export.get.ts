import { query, queryOne } from '../../utils/db'
import { requireAdmin } from '../../utils/auth'
import { BACKUP_TABLES } from '../../utils/backupTables'
import { buildHead, buildTableSql, buildTail } from '../../utils/backupExport'

export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const tableRows = await query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table'`
  )
  const existing = new Set(tableRows.map((r) => r.name))
  const orderedTables = BACKUP_TABLES.filter((t) => existing.has(t))

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder()
      const write = (s: string) => controller.enqueue(enc.encode(s))

      write(buildHead(new Date().toISOString()))

      for (const table of orderedTables) {
        const schema = await queryOne<{ sql: string }>(
          `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
          [table]
        )
        if (!schema || !schema.sql) continue
        const rows = await query<any>(`SELECT * FROM ${table}`)
        write(buildTableSql(table, schema.sql, rows))
      }

      const indexes = await query<{ sql: string; tbl_name: string }>(
        `SELECT sql, tbl_name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL`
      )
      const allowedTables = new Set(orderedTables)
      write(buildTail(indexes.filter((idx) => allowedTables.has(idx.tbl_name)).map((idx) => idx.sql)))

      controller.close()
    },
  })

  // 不走 content-encoding（fetch 会自动解压导致下载的是明文），直接输出 gzip 字节流
  const gzip = new CompressionStream('gzip')
  const body = stream.pipeThrough(gzip)

  const date = new Date().toISOString().slice(0, 10)
  setResponseHeader(event, 'content-type', 'application/octet-stream')
  setResponseHeader(event, 'content-disposition', `attachment; filename="backup-${date}.sql.gz"`)
  return sendStream(event, body)
})
