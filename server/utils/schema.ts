import { batch } from './db'

const SMS_CODES_DDL = `CREATE TABLE IF NOT EXISTS sms_codes (
    phone TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    store_id INTEGER REFERENCES stores(id),
    expires_at INTEGER NOT NULL,
    attempts INTEGER DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 0,
    day_start INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now', '+8 hours'))
  )`

const SMS_SETTINGS_DDL = `CREATE TABLE IF NOT EXISTS sms_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    sms_provider TEXT,
    sms_access_key TEXT,
    sms_secret TEXT,
    sms_sign_name TEXT,
    sms_sdk_app_id TEXT,
    sms_region TEXT,
    sms_enabled_balance INTEGER DEFAULT 0,
    sms_template_balance TEXT,
    sms_enabled_count INTEGER DEFAULT 0,
    sms_template_count TEXT,
    sms_enabled_points INTEGER DEFAULT 0,
    sms_template_points TEXT,
    sms_code_login INTEGER DEFAULT 0,
    sms_template_code TEXT,
    sms_code_daily_limit INTEGER DEFAULT 10,
    sms_code_expiry_min INTEGER DEFAULT 5
  )`

const SMS_SETTINGS_SEED = `INSERT OR IGNORE INTO sms_settings (id) VALUES (1)`

const LOGIN_ATTEMPTS_DDL = `CREATE TABLE IF NOT EXISTS login_attempts (
    id TEXT PRIMARY KEY,
    fails INTEGER NOT NULL DEFAULT 0,
    lock_until INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`

const DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    address TEXT,
    phone TEXT,
    created_at TEXT DEFAULT (datetime('now', '+8 hours'))
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER REFERENCES stores(id),
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','manager','clerk')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', '+8 hours'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_store_phone ON users(store_id, phone)`,
  `CREATE TABLE IF NOT EXISTS setup_lock (
    id INTEGER PRIMARY KEY CHECK(id = 1)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_admin_phone_unique ON users(phone) WHERE store_id IS NULL`,
  `CREATE TABLE IF NOT EXISTS settings (
    store_id INTEGER PRIMARY KEY REFERENCES stores(id),
    vip_discount_rate REAL DEFAULT 1,
    points_earn_rate REAL DEFAULT 1,
    points_redeem_amount INTEGER DEFAULT 100,
    points_redeem_value REAL DEFAULT 1,
    balance_payment_enabled INTEGER DEFAULT 1,
    points_payment_enabled INTEGER DEFAULT 1,
    default_stock_alert REAL DEFAULT 10
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    name TEXT NOT NULL,
    short_code TEXT NOT NULL,
    barcode TEXT,
    primary_unit TEXT NOT NULL,
    selling_price REAL NOT NULL,
    secondary_unit TEXT,
    conversion_rate REAL,
    secondary_price REAL,
    cost_price REAL,
    discountable INTEGER DEFAULT 1,
    stock_quantity REAL DEFAULT 0,
    stock_alert REAL DEFAULT 10,
    status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
    created_at TEXT DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT DEFAULT (datetime('now', '+8 hours')),
    UNIQUE(store_id, short_code)
  )`,
  `CREATE TABLE IF NOT EXISTS product_stock_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    store_id INTEGER NOT NULL REFERENCES stores(id),
    type TEXT NOT NULL CHECK(type IN ('入库','出库','盘点','销售','退货')),
    quantity_change REAL NOT NULL,
    stock_after REAL NOT NULL,
    cost_price REAL,
    supplier TEXT,
    notes TEXT,
    related_order_id INTEGER,
    operator_id INTEGER REFERENCES users(id),
    idempotency_key TEXT,
    created_at TEXT DEFAULT (datetime('now', '+8 hours'))
  )`,
  `CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    birthday TEXT,
    level TEXT DEFAULT 'normal' CHECK(level IN ('normal','vip')),
    balance REAL DEFAULT 0,
    points INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT DEFAULT (datetime('now', '+8 hours')),
    UNIQUE(store_id, phone)
  )`,
  `CREATE TABLE IF NOT EXISTS point_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id),
    store_id INTEGER NOT NULL REFERENCES stores(id),
    type TEXT NOT NULL CHECK(type IN ('earn','redeem','refund','deduct')),
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    related_order_id INTEGER,
    operator_id INTEGER REFERENCES users(id),
    notes TEXT,
    idempotency_key TEXT,
    created_at TEXT DEFAULT (datetime('now', '+8 hours'))
  )`,
  `CREATE TABLE IF NOT EXISTS balance_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id),
    store_id INTEGER NOT NULL REFERENCES stores(id),
    type TEXT NOT NULL CHECK(type IN ('recharge','consume','refund')),
    amount REAL NOT NULL,
    bonus_amount REAL DEFAULT 0,
    balance_after REAL NOT NULL,
    related_order_id INTEGER,
    source_log_id INTEGER,
    operator_id INTEGER REFERENCES users(id),
    notes TEXT,
    idempotency_key TEXT,
    created_at TEXT DEFAULT (datetime('now', '+8 hours'))
  )`,
  `CREATE TABLE IF NOT EXISTS count_services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    name TEXT NOT NULL,
    total_count INTEGER NOT NULL,
    price REAL NOT NULL,
    validity_months INTEGER,
    status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
    created_at TEXT DEFAULT (datetime('now', '+8 hours'))
  )`,
  `CREATE TABLE IF NOT EXISTS member_count_services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id),
    store_id INTEGER NOT NULL REFERENCES stores(id),
    service_id INTEGER NOT NULL REFERENCES count_services(id),
    remaining_count INTEGER NOT NULL,
    paid_amount REAL DEFAULT 0,
    purchased_at TEXT,
    expires_at TEXT,
    idempotency_key TEXT,
    created_at TEXT DEFAULT (datetime('now', '+8 hours'))
  )`,
  `CREATE TABLE IF NOT EXISTS count_usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_service_id INTEGER NOT NULL REFERENCES member_count_services(id),
    store_id INTEGER NOT NULL REFERENCES stores(id),
    deduction_count INTEGER NOT NULL,
    unit_amount REAL DEFAULT 0,
    remaining_after INTEGER NOT NULL,
    related_order_id INTEGER,
    operator_id INTEGER REFERENCES users(id),
    idempotency_key TEXT,
    created_at TEXT DEFAULT (datetime('now', '+8 hours'))
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    type TEXT NOT NULL CHECK(type IN ('sale','return')),
    member_id INTEGER REFERENCES members(id),
    original_order_id INTEGER REFERENCES orders(id),
    total_amount REAL NOT NULL,
    member_discount REAL DEFAULT 0,
    order_discount REAL DEFAULT 0,
    payable_amount REAL NOT NULL DEFAULT 0,
    points_earned INTEGER DEFAULT 0,
    cash_amount REAL DEFAULT 0,
    balance_amount REAL DEFAULT 0,
    points_amount INTEGER DEFAULT 0,
    points_value REAL DEFAULT 0,
    operator_id INTEGER REFERENCES users(id),
    idempotency_key TEXT,
    created_at TEXT DEFAULT (datetime('now', '+8 hours'))
  )`,
  `CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id INTEGER REFERENCES products(id),
    product_name TEXT NOT NULL,
    product_unit TEXT NOT NULL,
    unit_price REAL NOT NULL,
    original_price REAL,
    quantity REAL NOT NULL,
    subtotal REAL NOT NULL,
    base_quantity REAL,
    base_unit TEXT,
    discount_amount REAL DEFAULT 0,
    cost_price REAL,
    count_service_id INTEGER REFERENCES count_services(id),
    created_at TEXT DEFAULT (datetime('now', '+8 hours'))
  )`,
  SMS_CODES_DDL,
  SMS_SETTINGS_DDL,
  LOGIN_ATTEMPTS_DDL,
  `CREATE INDEX IF NOT EXISTS idx_login_attempts_lock ON login_attempts(lock_until)`,
  `CREATE INDEX IF NOT EXISTS idx_products_store_id ON products(store_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_name_unique ON stores(name COLLATE NOCASE)`,
  `CREATE INDEX IF NOT EXISTS idx_members_store_id ON members(store_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_store_id ON orders(store_id)`,
  `CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_product_stock_logs_product_id ON product_stock_logs(product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_balance_logs_member_id ON balance_logs(member_id)`,
  `CREATE INDEX IF NOT EXISTS idx_balance_logs_store_type ON balance_logs(store_id, type)`,
  `CREATE INDEX IF NOT EXISTS idx_point_logs_member_id ON point_logs(member_id)`,
  `CREATE INDEX IF NOT EXISTS idx_point_logs_store_type ON point_logs(store_id, type)`,
  `CREATE INDEX IF NOT EXISTS idx_point_logs_store_created ON point_logs(store_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_balance_logs_store_created ON balance_logs(store_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_operator ON orders(operator_id)`,
  `CREATE INDEX IF NOT EXISTS idx_product_stock_logs_operator ON product_stock_logs(operator_id)`,
  `CREATE INDEX IF NOT EXISTS idx_balance_logs_operator ON balance_logs(operator_id)`,
  `CREATE INDEX IF NOT EXISTS idx_count_usage_logs_operator ON count_usage_logs(operator_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_product_stock_logs_idempotency ON product_stock_logs(store_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_orders_store_created ON orders(store_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_store_type_created ON orders(store_id, type, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_original_order ON orders(original_order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_member_id ON orders(member_id)`,
  `CREATE INDEX IF NOT EXISTS idx_product_stock_logs_store_created ON product_stock_logs(store_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_product_stock_logs_related_order ON product_stock_logs(related_order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_balance_logs_related_order ON balance_logs(related_order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_balance_logs_source_log ON balance_logs(source_log_id) WHERE source_log_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_point_logs_related_order ON point_logs(related_order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_member_count_services_member ON member_count_services(member_id)`,
  `CREATE INDEX IF NOT EXISTS idx_count_services_store_id ON count_services(store_id)`,
  `CREATE INDEX IF NOT EXISTS idx_member_count_services_store_purchased ON member_count_services(store_id, purchased_at)`,
  `CREATE INDEX IF NOT EXISTS idx_count_usage_logs_member_service ON count_usage_logs(member_service_id)`,
  `CREATE INDEX IF NOT EXISTS idx_count_usage_logs_store_created ON count_usage_logs(store_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_products_store_status_stock ON products(store_id, status, stock_quantity, stock_alert)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_count_usage_logs_revert_marker ON count_usage_logs(member_service_id, related_order_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique ON products(store_id, barcode) WHERE barcode IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency ON orders(store_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_balance_logs_idempotency ON balance_logs(store_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_point_logs_idempotency ON point_logs(store_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_count_usage_logs_idempotency ON count_usage_logs(store_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_member_count_services_idempotency ON member_count_services(store_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_members_store_name_nc ON members(store_id, name COLLATE NOCASE)`,
  `CREATE INDEX IF NOT EXISTS idx_members_store_phone_nc ON members(store_id, phone COLLATE NOCASE)`,
  `CREATE INDEX IF NOT EXISTS idx_products_store_name_nc ON products(store_id, name COLLATE NOCASE)`,
  `CREATE INDEX IF NOT EXISTS idx_products_store_barcode_nc ON products(store_id, barcode COLLATE NOCASE)`,
  `CREATE INDEX IF NOT EXISTS idx_products_store_shortcode_nc ON products(store_id, short_code COLLATE NOCASE)`,
]

let _ensuring: Promise<void> | null = null
const g = globalThis as any
if (!g.__schemaEnsuring) g.__schemaEnsuring = null
if (typeof g.__schemaInitialized !== 'boolean') g.__schemaInitialized = false

export async function ensureSchema(): Promise<void> {
  if (g.__schemaInitialized) return
  if (_ensuring) return _ensuring
  if (g.__schemaEnsuring) return g.__schemaEnsuring

  const run = (async () => {
    await batch([...DDL_STATEMENTS, SMS_SETTINGS_SEED].map((sql) => ({ sql })))
    g.__schemaInitialized = true
  })().catch((err) => {
    _ensuring = null
    g.__schemaEnsuring = null
    throw err
  })

  _ensuring = run
  g.__schemaEnsuring = run
  return run
}

export function resetSchemaCache(): void {
  g.__schemaInitialized = false
  _ensuring = null
  g.__schemaEnsuring = null
}
