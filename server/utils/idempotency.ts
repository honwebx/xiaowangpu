import { queryOne } from './db'

export function isUniqueConflict(err: any): boolean {
  return /UNIQUE.*constraint|idx_.*_idempotency/i.test(String(err?.message || ''))
}

export type IdempotentLogTable = 'balance_logs' | 'point_logs' | 'count_usage_logs' | 'product_stock_logs' | 'orders' | 'member_count_services'

export async function findIdempotentLog<T = any>(
  storeId: number,
  key: string | undefined,
  table: IdempotentLogTable
): Promise<T | null> {
  if (!key) return null
  return queryOne<T>(
    `SELECT * FROM ${table} WHERE store_id = ? AND idempotency_key = ?`,
    [storeId, key]
  )
}
