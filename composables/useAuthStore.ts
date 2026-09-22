import type { Role } from '~~/types'

export type { Role }

export interface AuthUser {
  id: number
  store_id: number | null
  name: string
  phone: string
  role: Role
}

export interface StoreInfo {
  id: number
  name: string
  address?: string
  phone?: string
}

export const TOKEN_KEY = 'token'
export const USER_KEY = 'user'
export const STORES_KEY = 'stores'
export const CURRENT_STORE_KEY = 'currentStoreId'

const token = ref<string | null>(null)
const user = ref<AuthUser | null>(null)
const stores = ref<StoreInfo[]>([])
const currentStoreId = ref<number | null>(null)

let initialized = false

function readJson<T>(key: string): T | null {
  const raw = localStorage.getItem(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function initFromStorage() {
  if (initialized) return
  initialized = true
  const t = localStorage.getItem(TOKEN_KEY)
  const u = readJson<AuthUser>(USER_KEY)
  const s = readJson<StoreInfo[]>(STORES_KEY)
  const c = localStorage.getItem(CURRENT_STORE_KEY)
  if (t) token.value = t
  if (u) user.value = u
  if (Array.isArray(s)) stores.value = s
  if (c !== null && c !== '') currentStoreId.value = Number(c)
}

function persist() {
  if (token.value) localStorage.setItem(TOKEN_KEY, token.value)
  else localStorage.removeItem(TOKEN_KEY)

  if (user.value) localStorage.setItem(USER_KEY, JSON.stringify(user.value))
  else localStorage.removeItem(USER_KEY)

  if (stores.value.length) localStorage.setItem(STORES_KEY, JSON.stringify(stores.value))
  else localStorage.removeItem(STORES_KEY)

  if (currentStoreId.value != null) localStorage.setItem(CURRENT_STORE_KEY, String(currentStoreId.value))
  else localStorage.removeItem(CURRENT_STORE_KEY)
}

export function useAuthStore() {
  initFromStorage()

  const userName = computed(() => user.value?.name ?? '')
  const userRole = computed<Role | null>(() => user.value?.role ?? null)
  const currentStore = computed<StoreInfo | null>(() =>
    stores.value.find((s) => s.id === currentStoreId.value) ?? null,
  )

  function setAuth(payload: {
    token: string
    user: AuthUser
    stores: StoreInfo[]
    currentStoreId?: number | null
  }) {
    token.value = payload.token
    user.value = payload.user
    stores.value = payload.stores

    if (payload.currentStoreId != null) {
      currentStoreId.value = payload.currentStoreId
    } else if (payload.user.role === 'admin') {
      currentStoreId.value = payload.stores[0]?.id ?? null
    } else {
      currentStoreId.value = payload.user.store_id
    }
    persist()
  }

  function setCurrentStore(storeId: number) {
    currentStoreId.value = storeId
    persist()
  }

  function setToken(newToken: string) {
    token.value = newToken
    persist()
  }

  function updateStores(newStores: StoreInfo[]) {
    stores.value = newStores
    persist()
  }

  function logout() {
    token.value = null
    user.value = null
    stores.value = []
    currentStoreId.value = null
    persist()
  }

  return {
    token,
    user,
    stores,
    currentStoreId,
    userName,
    userRole,
    currentStore,
    setAuth,
    setToken,
    setCurrentStore,
    updateStores,
    logout,
  }
}
