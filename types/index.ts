export type Role = 'admin' | 'manager' | 'clerk'

export interface Store {
  id: number
  name: string
  address: string | null
  phone: string | null
  created_at: string
}

export interface User {
  id: number
  store_id: number | null
  name: string
  phone: string
  password_hash: string
  role: 'admin' | 'manager' | 'clerk'
  status: 'active' | 'inactive'
  token_version: number
  created_at: string
}

export interface Product {
  id: number
  store_id: number
  name: string
  short_code: string
  barcode: string | null
  primary_unit: string
  selling_price: number
  secondary_unit: string | null
  conversion_rate: number | null
  secondary_price: number | null
  cost_price: number | null
  discountable: number
  stock_quantity: number
  stock_alert: number
  status: 'active' | 'inactive'
  created_at: string
  updated_at: string
}

export interface ProductStockLog {
  id: number
  product_id: number
  store_id: number
  type: '入库' | '出库' | '盘点' | '销售' | '退货'
  quantity_change: number
  stock_after: number
  cost_price: number | null
  supplier: string | null
  notes: string | null
  related_order_id: number | null
  operator_id: number | null
  idempotency_key?: string | null
  created_at: string
}

export interface Member {
  id: number
  store_id: number
  name: string
  phone: string
  birthday: string | null
  level: 'normal' | 'vip'
  balance: number
  points: number
  notes?: string | null
  created_at: string
  updated_at: string
}

export interface PointLog {
  id: number
  member_id: number
  store_id: number
  type: 'earn' | 'redeem' | 'refund' | 'deduct'
  amount: number
  balance_after: number
  related_order_id: number | null
  operator_id: number | null
  operator_name?: string | null
  notes: string | null
  idempotency_key?: string | null
  created_at: string
}

export interface BalanceLog {
  id: number
  member_id: number
  store_id: number
  type: 'recharge' | 'consume' | 'refund'
  amount: number
  bonus_amount: number
  balance_after: number
  related_order_id: number | null
  source_log_id?: number | null
  operator_id: number | null
  operator_name?: string | null
  notes: string | null
  idempotency_key?: string | null
  created_at: string
}

export interface CountService {
  id: number
  store_id: number
  name: string
  total_count: number
  price: number
  validity_months: number | null
  status: 'active' | 'inactive'
  created_at: string
}

export interface MemberCountService {
  id: number
  member_id: number
  store_id: number
  service_id: number
  remaining_count: number
  paid_amount: number
  purchased_at: string | null
  expires_at: string | null
  idempotency_key?: string | null
  created_at: string
}

export interface MemberCountServiceView extends MemberCountService {
  service_name: string
  total_count: number
  validity_months: number | null
}

export interface CountUsageLog {
  id: number
  member_service_id: number
  store_id: number
  deduction_count: number
  unit_amount: number
  remaining_after: number
  related_order_id: number | null
  operator_id: number | null
  operator_name?: string | null
  idempotency_key?: string | null
  created_at: string
}

export interface Order {
  id: number
  store_id: number
  type: 'sale' | 'return'
  member_id: number | null
  original_order_id: number | null
  total_amount: number
  member_discount: number
  order_discount: number
  payable_amount: number
  points_earned: number
  cash_amount: number
  balance_amount: number
  points_amount: number
  points_value: number
  operator_id: number | null
  idempotency_key?: string | null
  created_at: string
  member_name?: string
  member_phone?: string
  operator_name?: string
  items?: OrderItem[]
}

export interface OrderItem {
  id: number
  order_id: number
  product_id: number | null
  product_name: string
  product_unit: string
  unit_price: number
  original_price: number | null
  quantity: number
  base_quantity: number
  base_unit: string
  returnable_quantity?: number
  subtotal: number
  discount_amount: number
  cost_price: number | null
  count_service_id: number | null
  created_at: string
}

export interface StoreSettings {
  store_id: number
  vip_discount_rate: number
  points_earn_rate: number
  points_redeem_amount: number
  points_redeem_value: number
  balance_payment_enabled: number
  points_payment_enabled: number
  default_stock_alert: number
}

export interface SmsSettings {
  id: number
  sms_provider: string | null
  sms_access_key: string | null
  sms_secret: string | null
  sms_sign_name: string | null
  sms_sdk_app_id: string | null
  sms_region: string | null
  sms_enabled_balance: number
  sms_template_balance: string | null
  sms_enabled_count: number
  sms_template_count: string | null
  sms_enabled_points: number
  sms_template_points: string | null
  sms_code_login: number
  sms_template_code: string | null
  sms_code_daily_limit: number
  sms_code_expiry_min: number
}

export interface SmsCode {
  phone: string
  code_hash: string
  store_id: number | null
  expires_at: number
  attempts: number
  sent_count: number
  day_start: number
  created_at: string
}

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
}

export interface LoginResponse {
  token: string
  user: {
    id: number
    name: string
    phone: string
  role: Role
    store_id: number | null
  }
  stores: Store[]
  defaultStoreId: number
}
