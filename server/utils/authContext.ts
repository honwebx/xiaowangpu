import { query, queryOne } from './db'
import { signToken } from './auth'
import type { Role } from '../../types'

const STORES_COLUMNS = 'id, name, address, phone'
const STORES_ORDERED_LIST_SQL = `SELECT ${STORES_COLUMNS} FROM stores ORDER BY id`
const STORE_BY_ID_SQL = `SELECT ${STORES_COLUMNS} FROM stores WHERE id = ?`

export interface AuthUserRow {
  id: number
  store_id: number | null
  name: string
  phone: string
  role: Role
  status: string
  token_version: number
}

export interface StoreInfo {
  id: number
  name: string
  address: string | null
  phone: string | null
}

export interface AuthResponse {
  token: string
  user: { id: number; store_id: number | null; name: string; phone: string; role: Role; status: string }
  stores: StoreInfo[]
  defaultStoreId: number | null
}

const BASE_USER_COLUMNS = 'id, store_id, name, phone, role, status, token_version'

export async function loadUserByPhone(phone: string, storeId: number | null): Promise<AuthUserRow | null> {
  if (storeId === null) {
    return await queryOne<AuthUserRow>(
      `SELECT ${BASE_USER_COLUMNS} FROM users WHERE phone = ? AND store_id IS NULL`,
      [phone],
    )
  }
  return await queryOne<AuthUserRow>(
    `SELECT ${BASE_USER_COLUMNS} FROM users WHERE phone = ? AND store_id = ?`,
    [phone, storeId],
  )
}

export interface LoadStoresResult {
  stores: StoreInfo[]
  defaultStoreId: number | null
}

export async function loadStoresForUser(
  user: { role: Role; store_id: number | null },
  requestedStoreId?: number | null,
): Promise<LoadStoresResult> {
  if (user.role === 'admin') {
    const stores = (await query<StoreInfo>(STORES_ORDERED_LIST_SQL)) || []
    if (requestedStoreId) {
      const exists = stores.find((s) => s.id === requestedStoreId)
      if (!exists) throw createError({ statusCode: 403, message: '无权访问该店铺' })
      return { stores, defaultStoreId: requestedStoreId }
    }
    return { stores, defaultStoreId: stores.length > 0 ? stores[0].id : null }
  }
  const store = await queryOne<StoreInfo>(STORE_BY_ID_SQL, [user.store_id])
  if (!store) throw createError({ statusCode: 403, message: '账号未绑定店铺，请联系管理员' })
  return { stores: [store], defaultStoreId: user.store_id }
}

export async function signAndFormat(
  user: AuthUserRow,
  stores: StoreInfo[],
  defaultStoreId: number | null,
): Promise<AuthResponse> {
  const token = await signToken({
    userId: user.id,
    role: user.role,
    name: user.name,
    phone: user.phone,
    storeId: user.store_id,
    status: user.status || 'active',
    tokenVersion: Number(user.token_version) || 0,
  })
  return {
    token,
    user: {
      id: user.id,
      store_id: user.store_id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      status: user.status,
    },
    stores,
    defaultStoreId,
  }
}

export async function issueAuthResponse(
  user: AuthUserRow,
  requestedStoreId?: number | null,
): Promise<AuthResponse> {
  const { stores, defaultStoreId } = await loadStoresForUser(user, requestedStoreId)
  return await signAndFormat(user, stores, defaultStoreId)
}
