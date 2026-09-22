export const BACKUP_TABLES = [
  'stores',
  'users',
  'settings',
  'sms_settings',
  'sms_codes',
  'products',
  'product_stock_logs',
  'members',
  'point_logs',
  'balance_logs',
  'count_services',
  'member_count_services',
  'count_usage_logs',
  'orders',
  'order_items',
]

// 已知不需要备份的表：setup_lock 为初始化锁（恢复后靠 users 表行数拦截重初始化），
// login_attempts 为登录限流临时数据。加业务表时必须同步 BACKUP_TABLES。
export const KNOWN_NON_BACKUP_TABLES = ['setup_lock', 'login_attempts']

const SYSTEM_TABLE_PREFIXES = ['_', 'sqlite_', 'd1_', 'cf_']

export function findUnbackedTables(existing: string[]): string[] {
  const backed = new Set([...BACKUP_TABLES, ...KNOWN_NON_BACKUP_TABLES])
  return existing.filter((name) => {
    if (backed.has(name)) return false
    const lower = name.toLowerCase()
    return !SYSTEM_TABLE_PREFIXES.some((p) => lower.startsWith(p))
  })
}
