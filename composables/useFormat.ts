import { round2 } from '~~/server/utils/db'

export { round2 }

export function formatMoney(n: number | null | undefined): string {
  const v = round2(Number(n))
  const abs = Math.abs(v).toFixed(2)
  return v < 0 ? `-${abs}` : abs
}

export function moneyWithSymbol(n: number | null | undefined, symbol = '¥'): string {
  const num = Number(n)
  const v = Number.isFinite(num) ? round2(num) : 0
  const abs = Math.abs(v).toFixed(2)
  return (v < 0 ? '-' : '') + symbol + abs
}

export function apiErr(e: any): string {
  return e?.data?.message || e?.data?.statusMessage || e?.message || '请求失败'
}
