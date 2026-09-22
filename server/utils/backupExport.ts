export const INSERT_BATCH_SIZE = 50

export function sqlLiteral(v: any): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'boolean') return v ? '1' : '0'
  const s = String(v).replace(/'/g, "''")
  return `'${s}'`
}

export function buildHead(generatedAt: string): string {
  return `-- 小旺铺 database backup\n-- Generated: ${generatedAt}\n\nPRAGMA defer_foreign_keys=ON;\n\n`
}

export function buildRowsSql(table: string, cols: string[], rows: any[]): string {
  if (rows.length === 0 || cols.length === 0) return ''
  const colList = cols.join(', ')
  let out = ''
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const chunk = rows.slice(i, i + INSERT_BATCH_SIZE)
    const tuples = chunk
      .map((row) => `(${cols.map((c) => sqlLiteral(row[c])).join(', ')})`)
      .join(',\n  ')
    out += `INSERT INTO ${table} (${colList}) VALUES\n  ${tuples};\n`
  }
  return out
}

export function buildTableSql(table: string, schemaSql: string, rows: any[]): string {
  let out = `DROP TABLE IF EXISTS ${table};\n${schemaSql};\n`
  if (rows.length > 0) {
    out += buildRowsSql(table, Object.keys(rows[0]), rows)
  }
  return out + '\n'
}

export function buildTail(indexSqls: string[]): string {
  let out = ''
  if (indexSqls.length > 0) {
    out += '-- indexes\n'
    for (const sql of indexSqls) out += `${sql};\n`
    out += '\n'
  }
  return out + 'PRAGMA defer_foreign_keys=OFF;\n'
}
