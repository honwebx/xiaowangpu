const REFRESH_BEFORE_MS = 15 * 60 * 1000
const CHECK_INTERVAL_MS = 5 * 60 * 1000

let timer: ReturnType<typeof setInterval> | null = null
let refreshing = false
let started = false

function tokenExpMs(token: string): number | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

async function refreshOnce(): Promise<void> {
  if (refreshing) return
  const authStore = useAuthStore()
  if (!authStore.token.value) return
  refreshing = true
  try {
    const res: any = await useApiFetch('/api/auth/refresh', { method: 'POST' })
    if (res?.token) authStore.setToken(res.token)
  } catch {
    // 401/403 时 useApiFetch 已自动登出并跳转，无需额外处理
  } finally {
    refreshing = false
  }
}

async function maybeRefresh(): Promise<void> {
  const authStore = useAuthStore()
  const token = authStore.token.value
  if (!token || document.visibilityState !== 'visible') return
  const exp = tokenExpMs(token)
  if (exp == null) return
  if (exp - Date.now() < REFRESH_BEFORE_MS) await refreshOnce()
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') void maybeRefresh()
}

export function useSessionRefresh() {
  function start() {
    if (started) return
    started = true
    void maybeRefresh()
    timer = setInterval(() => void maybeRefresh(), CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
    document.removeEventListener('visibilitychange', onVisibilityChange)
    started = false
  }

  return { start, stop, maybeRefresh }
}
