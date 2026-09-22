export function beijingDateRange(dateStr: string): [string, string] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim())
  if (!m) return [dateStr, dateStr]
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const start = `${m[1]}-${m[2]}-${m[3]} 00:00:00`
  const t = new Date(Date.UTC(y, mo - 1, d + 1))
  const pad = (n: number) => String(n).padStart(2, '0')
  const end = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} 00:00:00`
  return [start, end]
}
