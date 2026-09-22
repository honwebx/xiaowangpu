const DASHBOARD_TODAY_TTL = 30_000
const DASHBOARD_STATIC_TTL = 300_000

interface Entry<T> {
  value: T
  expiresAt: number
}

const dashboardTodayCache = new Map<string, Entry<any>>()
const dashboardStaticCache = new Map<string, Entry<any>>()

function getFrom<K, V>(map: Map<K, Entry<V>>, key: K): V | undefined {
  const entry = map.get(key)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    map.delete(key)
    return undefined
  }
  return entry.value
}

export function getCachedDashboardToday(storeId: number): any | undefined {
  return getFrom(dashboardTodayCache, String(storeId))
}

export function setCachedDashboardToday(storeId: number, value: any): void {
  dashboardTodayCache.set(String(storeId), { value, expiresAt: Date.now() + DASHBOARD_TODAY_TTL })
}

export function getCachedDashboardStatic(key: string): any | undefined {
  return getFrom(dashboardStaticCache, key)
}

export function setCachedDashboardStatic(key: string, value: any): void {
  dashboardStaticCache.set(key, { value, expiresAt: Date.now() + DASHBOARD_STATIC_TTL })
}

export function dashboardKey(storeId: number | null, year: number, monthProvided: boolean, month: number): string {
  return `${storeId ?? 0}|${year}|${monthProvided ? month : 0}`
}

export function invalidateDashboard(): void {
  dashboardTodayCache.clear()
  dashboardStaticCache.clear()
}

const USER_VERSION_TTL = 30_000
const userVersionCache = new Map<number, Entry<{ version: number; status: string } | null>>()

export function getCachedUserVersion(userId: number): { version: number; status: string } | null | undefined {
  return getFrom(userVersionCache, userId)
}

export function setCachedUserVersion(userId: number, value: { version: number; status: string } | null): void {
  userVersionCache.set(userId, { value, expiresAt: Date.now() + USER_VERSION_TTL })
}

export function invalidateUserVersion(userId: number | null | undefined): void {
  if (userId == null) return
  userVersionCache.delete(userId)
}

export function invalidateAllUserVersions(): void {
  userVersionCache.clear()
}
