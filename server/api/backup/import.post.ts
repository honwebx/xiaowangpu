import { execSql, execute, batch } from '../../utils/db'
import { requireAdmin } from '../../utils/auth'
import { ensureSchema, resetSchemaCache } from '../../utils/schema'
import { invalidateAllUserVersions, invalidateDashboard } from '../../utils/cache'
import { BACKUP_TABLES } from '../../utils/backupTables'

const MAX_INPUT_BYTES = 50 * 1024 * 1024
const MAX_DECOMPRESSED_BYTES = 200 * 1024 * 1024
const EXEC_CHUNK_SIZE = 100
const MERGE_BATCH_ROWS = 200

// 字符串感知地按 ';' 切分 SQL 为语句数组，同遍剥离 -- 行注释。
// 不切分字符串字面量内的 ';'，不剥离字符串内的 '--'，保留字符串内换行（多行 TEXT 值原样）。
// D1 的 db.exec() 按行切分、处理不了多行语句，故改由本函数正确切分后用 batch(prepare) 执行。
function splitSqlStatements(sql: string): string[] {
  const out: string[] = []
  const buf: string[] = []
  let i = 0
  let inStr = false
  const n = sql.length
  const flush = () => {
    const s = buf.join('').trim()
    if (s) out.push(s)
    buf.length = 0
  }
  while (i < n) {
    const ch = sql[i]
    if (inStr) {
      buf.push(ch)
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          buf.push("'")
          i += 2
          continue
        }
        inStr = false
      }
      i++
      continue
    }
    if (ch === "'") {
      inStr = true
      buf.push(ch)
      i++
      continue
    }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++
      continue
    }
    if (ch === ';') {
      flush()
      i++
      continue
    }
    buf.push(ch)
    i++
  }
  flush()
  return out
}

// 业务表 DROP/DELETE 拦截：仅允许业务表及其迁移临时表（`__new_` 等前缀归一化）
// 系统表（D1 保留表 _cf_KV、迁移记录 d1_migrations、NuxtHub _hub_migrations、
// AUTOINCREMENT 计数表 sqlite_sequence）直接跳过、不校验不执行；
// wrangler d1 export 的 dump 无 DROP、自带系统表与事务关键字，同样在此兼容。
const IMPORT_TEMP_PREFIXES = ['new_', 'old_', 'bak_', 'backup_', 'tmp_', 'temp_']
const IMPORT_DML_EXTRA_TABLES = ['sqlite_sequence']

function isSystemTable(name: string): boolean {
  const t = name.toLowerCase()
  return t.startsWith('_') || t.startsWith('sqlite_') || t.startsWith('d1_') || t.startsWith('cf_')
}

function normalizeImportTable(name: string): string {
  let t = name.toLowerCase().replace(/^_+/, '')
  for (const p of IMPORT_TEMP_PREFIXES) {
    if (t.startsWith(p)) {
      t = t.slice(p.length)
      break
    }
  }
  return t
}

function isDropAllowedTable(tbl: string): boolean {
  return BACKUP_TABLES.includes(normalizeImportTable(tbl))
}

function isDmlAllowedTable(tbl: string): boolean {
  const n = normalizeImportTable(tbl)
  return BACKUP_TABLES.includes(n) || IMPORT_DML_EXTRA_TABLES.includes(n)
}

function matchTable(re: RegExp, stmt: string): string | undefined {
  return stmt.match(re)?.[1]?.toLowerCase()
}

const DROP_TABLE_RE = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"'\[]?(\w+)/i
const DELETE_FROM_RE = /DELETE\s+FROM\s+[`"'\[]?(\w+)/i
const UPDATE_TABLE_RE = /UPDATE\s+(?:OR\s+\w+\s+)?[`"'\[]?(\w+)/i
const CREATE_TABLE_RE = /CREATE\s+(?:UNIQUE\s+)?(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"'\[]?(\w+)/i
const CREATE_INDEX_RE = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"'\[]?\w+[`"'\]]?\s+ON\s+[`"'\[]?(\w+)/i
const INSERT_TABLE_RE = /INSERT\s+(?:OR\s+(?:IGNORE|REPLACE|ROLLBACK|ABORT|FAIL)\s+)?INTO\s+[`"'\[]?(\w+)/i
const ALTER_TABLE_RE = /ALTER\s+TABLE\s+[`"'\[]?(\w+)/i

const TXN_HEADS = new Set(['BEGIN', 'COMMIT', 'TRANSACTION', 'END', 'ROLLBACK'])

function validateStatements(stmts: string[]): { ok: boolean; reason?: string } {
  for (const stmt of stmts) {
    const head = stmt.split(/\s+/, 1)[0]?.toUpperCase()
    if (head === 'PRAGMA' || TXN_HEADS.has(head)) continue
    if (head === 'CREATE') {
      const tbl = matchTable(CREATE_TABLE_RE, stmt) ?? matchTable(CREATE_INDEX_RE, stmt)
      if (!tbl) {
        return { ok: false, reason: `禁止的 CREATE 语句：${stmt.slice(0, 60)}` }
      }
      if (isSystemTable(tbl)) continue
      if (!isDropAllowedTable(tbl)) {
        return { ok: false, reason: `禁止 CREATE 非业务表：${tbl}` }
      }
      continue
    }
    if (head === 'INSERT') {
      const tbl = matchTable(INSERT_TABLE_RE, stmt)
      if (!tbl) {
        return { ok: false, reason: `禁止的 INSERT 语句：${stmt.slice(0, 60)}` }
      }
      if (isSystemTable(tbl)) continue
      if (!isDropAllowedTable(tbl)) {
        return { ok: false, reason: `禁止 INSERT 非业务表：${tbl}` }
      }
      continue
    }
    if (head === 'DROP') {
      const tbl = matchTable(DROP_TABLE_RE, stmt)
      if (!tbl || isSystemTable(tbl)) continue
      if (!isDropAllowedTable(tbl)) {
        return { ok: false, reason: `禁止 DROP 非业务表：${tbl}` }
      }
      continue
    }
    if (head === 'DELETE') {
      const tbl = matchTable(DELETE_FROM_RE, stmt)
      if (!tbl || isSystemTable(tbl)) continue
      if (!isDmlAllowedTable(tbl)) {
        return { ok: false, reason: `禁止 DELETE 非业务表：${tbl}` }
      }
      continue
    }
    if (head === 'UPDATE') {
      const tbl = matchTable(UPDATE_TABLE_RE, stmt)
      if (!tbl || isSystemTable(tbl)) continue
      if (!isDmlAllowedTable(tbl)) {
        return { ok: false, reason: `禁止 UPDATE 非业务表：${tbl}` }
      }
      continue
    }
    if (head === 'ALTER') {
      const tbl = matchTable(ALTER_TABLE_RE, stmt)
      if (!tbl || isSystemTable(tbl)) continue
      if (!isDropAllowedTable(tbl)) {
        return { ok: false, reason: `禁止 ALTER 非业务表：${tbl}` }
      }
      continue
    }
    return { ok: false, reason: `禁止的语句类型：${head}` }
  }
  return { ok: true }
}

function businessTableOf(stmt: string): string | undefined {
  const head = stmt.split(/\s+/, 1)[0]?.toUpperCase()
  let raw: string | undefined
  if (head === 'DROP') raw = matchTable(DROP_TABLE_RE, stmt)
  else if (head === 'CREATE') raw = matchTable(CREATE_TABLE_RE, stmt) ?? matchTable(CREATE_INDEX_RE, stmt)
  else if (head === 'INSERT') raw = matchTable(INSERT_TABLE_RE, stmt)
  else if (head === 'DELETE') raw = matchTable(DELETE_FROM_RE, stmt)
  else if (head === 'UPDATE') raw = matchTable(UPDATE_TABLE_RE, stmt)
  else if (head === 'ALTER') raw = matchTable(ALTER_TABLE_RE, stmt)
  else return undefined
  if (!raw || isSystemTable(raw)) return undefined
  const n = normalizeImportTable(raw)
  return BACKUP_TABLES.includes(n) ? n : undefined
}

function splitInsertSingle(stmt: string): { key: string; head: string; tuple: string } | null {
  const m = stmt.match(/^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+([`"'[]?)(\w+)\1?\s*(\([^;]*?\))?\s*VALUES\s*/i)
  if (!m) return null
  const head = stmt.slice(0, m[0].length)
  const tuple = stmt.slice(m[0].length).trim()
  if (!tuple.startsWith('(')) return null
  let depth = 0
  let inS = false
  for (let i = 0; i < tuple.length; i++) {
    const ch = tuple[i]
    if (inS) {
      if (ch === "'") {
        if (tuple[i + 1] === "'") i++
        else inS = false
      }
      continue
    }
    if (ch === "'") inS = true
    else if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth < 0) return null
      if (depth === 0 && i !== tuple.length - 1) return null
    }
  }
  if (depth !== 0 || inS) return null
  return { key: m[2].toLowerCase() + '|' + (m[3] ?? '').toLowerCase(), head, tuple }
}

function mergeSingleRowInserts(stmts: string[]): string[] {
  type Item = { kind: 'sql'; sql: string } | { kind: 'group'; key: string }
  const items: Item[] = []
  const groups = new Map<string, { head: string; chunks: string[][] }>()
  for (const s of stmts) {
    const part = splitInsertSingle(s)
    if (!part) {
      items.push({ kind: 'sql', sql: s })
      continue
    }
    let g = groups.get(part.key)
    if (!g) {
      g = { head: part.head, chunks: [] }
      groups.set(part.key, g)
      items.push({ kind: 'group', key: part.key })
    }
    if (g.head !== part.head) {
      items.push({ kind: 'sql', sql: s })
      continue
    }
    const last = g.chunks[g.chunks.length - 1]
    if (last && last.length < MERGE_BATCH_ROWS) last.push(part.tuple)
    else g.chunks.push([part.tuple])
  }
  const out: string[] = []
  for (const it of items) {
    if (it.kind === 'sql') {
      out.push(it.sql)
      continue
    }
    const g = groups.get(it.key)!
    for (const c of g.chunks) {
      if (c.length === 0) continue
      out.push(c.length === 1 ? `${g.head}${c[0]}` : `${g.head}${c.join(',')}`)
    }
  }
  return out
}

function decodeBase64(input: string): Uint8Array {
  const binary = atob(input)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function isGzip(buf: Uint8Array): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b
}

async function readStreamWithLimit(stream: ReadableStream<Uint8Array>, limit: number): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  const chunks: string[] = []
  let total = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      throw new Error(`解压后内容超过 ${(limit / 1024 / 1024).toFixed(0)}MB 上限`)
    }
    chunks.push(decoder.decode(value, { stream: true }))
  }
  chunks.push(decoder.decode())
  return chunks.join('')
}

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const body = await readBody(event)
  const data = body?.data
  const filename = String(body?.filename || '')
  if (typeof data !== 'string' || !data) {
    throw createError({ statusCode: 400, message: '上传内容不能为空' })
  }

  let raw: Uint8Array
  try {
    raw = decodeBase64(data)
  } catch {
    throw createError({ statusCode: 400, message: '上传内容不是有效的 base64' })
  }
  if (raw.length === 0) {
    throw createError({ statusCode: 400, message: 'SQL 内容不能为空' })
  }
  if (raw.length > MAX_INPUT_BYTES) {
    throw createError({ statusCode: 400, message: `上传文件超过 ${(MAX_INPUT_BYTES / 1024 / 1024).toFixed(0)}MB 上限` })
  }

  const looksGzipByName = /\.(sql\.gz|gz)$/i.test(filename)
  let sql: string
  if (isGzip(raw) || looksGzipByName) {
    try {
      sql = await readStreamWithLimit(
        new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip')),
        MAX_DECOMPRESSED_BYTES,
      )
    } catch (err: any) {
      throw createError({ statusCode: 400, message: 'gzip 解压失败: ' + (err?.message || '未知错误') })
    }
  } else {
    sql = new TextDecoder('utf-8').decode(raw)
  }

  const stmts = splitSqlStatements(sql)
  if (stmts.length === 0) {
    throw createError({ statusCode: 400, message: 'SQL 内容不能为空' })
  }

  const validation = validateStatements(stmts)
  if (!validation.ok) {
    throw createError({ statusCode: 400, message: '导入内容包含禁止的语句：' + validation.reason })
  }

  const drops: string[] = []
  const rest: string[] = []
  const fileTables = new Set<string>()
  for (const s of stmts) {
    const head = s.split(/\s+/, 1)[0]?.toUpperCase()
    if (head === 'PRAGMA' || TXN_HEADS.has(head)) continue
    const tbl = businessTableOf(s)
    if (!tbl) continue
    fileTables.add(tbl)
    if (head === 'DROP') drops.push(s)
    else rest.push(s)
  }
  const droppedTables = new Set(
    drops.map((d) => businessTableOf(d)).filter((t): t is string => !!t),
  )
  const missingTables = BACKUP_TABLES.filter((t) => !fileTables.has(t))
  if (missingTables.length > 0) {
    throw createError({ statusCode: 400, message: '备份不完整，缺少表：' + missingTables.join('、') })
  }
  for (const t of BACKUP_TABLES) {
    if (fileTables.has(t) && !droppedTables.has(t)) {
      drops.push(`DROP TABLE IF EXISTS ${t}`)
    }
  }
  drops.reverse()

  try {
    // Phase 1：删表。删被引用的表会违反外键，用 defer_foreign_keys 延迟到事务末尾；
    // 全为单行 DROP 语句，db.exec() 可处理；结束时表全删、无外键 → 一致通过。
    if (drops.length > 0) {
      const dropSql = 'PRAGMA defer_foreign_keys=ON;\n' + drops.map((d) => d + ';').join('\n') + '\n'
      await execSql(dropSql)
    }
    // Phase 2：建表+插数据。多行语句 db.exec() 按行切分会报 incomplete，改用 batch
    // （内部 prepare 原生支持多行/多行字符串值）；父表优先 → 每个 batch 边界外键自洽，可安全分块。
    // d1 export 系单行 INSERT，先按表合并为多值批量，语句数从 N 降到 N/200。
    // 失败后允许原文件直接重导：DROP 全用 IF EXISTS，CREATE 全用 IF NOT EXISTS。
    const merged = mergeSingleRowInserts(rest)
    const totalChunks = Math.max(1, Math.ceil(merged.length / EXEC_CHUNK_SIZE))
    for (let i = 0; i < merged.length; i += EXEC_CHUNK_SIZE) {
      const chunk = merged.slice(i, i + EXEC_CHUNK_SIZE)
      if (chunk.length === 0) continue
      const chunkNo = Math.floor(i / EXEC_CHUNK_SIZE) + 1
      try {
        await batch(chunk.map((s) => ({ sql: s })))
      } catch (err: any) {
        const tbl = businessTableOf(chunk[0]) ?? '未知表'
        throw createError({ statusCode: 500, message: `导入失败（第 ${chunkNo}/${totalChunks} 批，约表 ${tbl}）：` + (err?.message || '未知错误') })
      }
    }
  } catch (err: any) {
    if (err?.statusCode) throw err
    throw createError({ statusCode: 500, message: '导入失败: ' + (err?.message || '未知错误') })
  }

  // 导入替换了 users 表：备份含相同账号时旧 JWT 仍能通过校验，必须让所有旧 token 失效。
  // 全员 token_version +1 并清进程版本缓存，此后旧 token 请求一律 401，前端自动登出。
  try {
    await execute('UPDATE users SET token_version = token_version + 1')
  } catch {
    // 备份无 users 表时忽略（ensureSchema 会补齐结构）
  }
  invalidateAllUserVersions()
  invalidateDashboard()

  resetSchemaCache()
  try {
    await ensureSchema()
  } catch (err: any) {
    throw createError({ statusCode: 500, message: 'schema 校验失败: ' + (err?.message || '未知错误') })
  }

  return { success: true, size: sql.length, statements: stmts.length }
})
