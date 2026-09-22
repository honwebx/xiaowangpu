import { queryOne } from '../../utils/db'
import { ensureStoreAccess, getAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const auth = getAuth(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, message: '缺少商品ID' })
  const product = await queryOne<any>('SELECT * FROM products WHERE id = ?', [id])
  if (!product) throw createError({ statusCode: 404, message: '商品不存在' })
  ensureStoreAccess(event, Number(product.store_id))
  if (auth.role === 'clerk') {
    return { ...product, cost_price: null }
  }
  return product
})
