function getDB() {
  if (typeof hubDatabase === 'function') {
    return hubDatabase()
  }
  const g = globalThis as any
  if (g.__env__?.DB) return g.__env__.DB
  throw new Error('Database not available')
}

export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const result = await getDB().prepare(sql).bind(...params).all()
  return (result.results || []) as T[]
}

export async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const result = await getDB().prepare(sql).bind(...params).all()
  return (result.results?.[0] as T) ?? null
}

export async function execute(sql: string, params: any[] = []): Promise<any> {
  return await getDB().prepare(sql).bind(...params).run()
}

export async function execSql(sql: string): Promise<void> {
  const db: any = getDB()
  if (typeof db.exec === 'function') {
    await db.exec(sql)
    return
  }
  // fallback 仅用于本地 mock；按分号切分会在 SQL 字符串字面量内的分号误切，调用方应避免
  const parts = sql.split(';').map((s: any) => s.trim()).filter(Boolean)
  for (const part of parts) {
    await db.prepare(part).bind().run()
  }
}

export async function batch(statements: { sql: string; params?: any[] }[]): Promise<any[]> {
  const db: any = getDB()
  const prepared = statements.map((s) => db.prepare(s.sql).bind(...(s.params || [])))
  if (typeof db.batch === 'function') {
    return await db.batch(prepared)
  }
  // fallback 仅用于本地 mock；非原子，调用方需自行处理部分失败补偿（如 orderService 已实现）
  const results: any[] = []
  for (const stmt of statements) {
    const r = await execute(stmt.sql, stmt.params || [])
    results.push(r)
  }
  return results
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}