import type { SmsConfig, SmsParams, SmsResult } from './types'
import { getProvider } from './providers/provider'
import './providers/aliyun'
import './providers/tencent'
import { createHmac, randomInt } from 'node:crypto'
import { execute, queryOne } from '../db'

const DAY = 24 * 60 * 60 * 1000
const MAX_ATTEMPTS = 5

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function hashCode(code: string): string {
  const secret = useRuntimeConfig().jwtSecret
  if (!secret) {
    throw createError({ statusCode: 500, message: 'JWT_SECRET 未配置' })
  }
  return createHmac('sha256', secret).update(String(code)).digest('hex')
}

function startOfDay(ts: number): number {
  return Math.floor((ts + 8 * 60 * 60 * 1000) / DAY) * DAY - 8 * 60 * 60 * 1000
}

export interface SendCodeResult {
  sent: boolean
  via: string
  code?: string
  expiresIn: number
}

export async function sendSms(params: SmsParams, config: SmsConfig): Promise<SmsResult> {
  const provider = getProvider(config.provider)
  if (!provider) return { success: false, error: `未知短信服务商: ${config.provider}` }
  return await provider.send(params, config)
}

export function buildSmsConfig(row: any): SmsConfig | null {
  if (!row?.sms_provider || !row?.sms_access_key || !row?.sms_secret || !row?.sms_sign_name) return null
  return {
    provider: row.sms_provider,
    accessKey: row.sms_access_key,
    secret: row.sms_secret,
    signName: row.sms_sign_name,
    sdkAppId: row.sms_sdk_app_id || '',
    region: row.sms_region || '',
    templates: {},
  }
}

export async function sendCode(
  phone: string,
  opts: {
    dailyLimit?: number
    expiryMin?: number
    config?: SmsConfig | null
    templateCode?: string
    storeId?: number | null
  } = {}
): Promise<SendCodeResult> {
  const dailyLimit = Math.max(1, opts.dailyLimit ?? 10)
  const expiryMin = Math.max(1, opts.expiryMin ?? 5)
  const resendIntervalMs = 60 * 1000
  const now = Date.now()
  const day = startOfDay(now)
  const existing = await queryOne<{ expires_at: number }>(
    'SELECT expires_at FROM sms_codes WHERE phone = ?',
    [phone],
  ).catch(() => null)
  if (existing && Number(existing.expires_at) - expiryMin * 60 * 1000 > now - resendIntervalMs) {
    throw createError({ statusCode: 429, message: '发送过于频繁，请稍后再试' })
  }
  const code = generateCode()
  const codeHash = hashCode(code)
  const expiresAt = now + expiryMin * 60 * 1000
  const bindStoreId = opts.storeId ?? null

  // 原子 upsert：同一 phone 仅一行；通过 WHERE 条件原子校验日发送上限，避免读-改-写竞态
  const res = await execute(
    `INSERT INTO sms_codes (phone, code_hash, store_id, expires_at, attempts, sent_count, day_start)
     VALUES (?, ?, ?, ?, 0, 1, ?)
     ON CONFLICT(phone) DO UPDATE SET
       code_hash = excluded.code_hash,
       store_id = excluded.store_id,
       expires_at = excluded.expires_at,
       attempts = 0,
       sent_count = CASE WHEN sms_codes.day_start = excluded.day_start THEN sms_codes.sent_count + 1 ELSE 1 END,
       day_start = excluded.day_start
     WHERE (sms_codes.day_start != excluded.day_start) OR (sms_codes.sent_count < ?)`,
    [phone, codeHash, bindStoreId, expiresAt, day, dailyLimit],
  )
  if (!res?.meta?.changes) {
    throw createError({ statusCode: 429, message: '今日验证码发送次数已达上限' })
  }

  const sent = await deliverCode(phone, code, opts.config || null, opts.templateCode)
  // 发送失败时回退本次计数，避免白白消耗用户日额度
  if (!sent) {
    await execute(
      `UPDATE sms_codes SET sent_count = CASE WHEN sent_count > 1 THEN sent_count - 1 ELSE 0 END WHERE phone = ?`,
      [phone],
    ).catch(() => {})
  }
  return {
    sent,
    via: sent ? 'sms' : import.meta.dev ? 'dev' : 'failed',
    code: !sent && import.meta.dev ? code : undefined,
    expiresIn: expiryMin * 60,
  }
}

export async function verifyCode(phone: string, code: string): Promise<boolean> {
  const cond = 'phone = ?'
  const params = [phone]
  const now = Date.now()

  // 原子消费一次尝试机会：attempts < MAX 且未过期才 +1，避免并发绕过尝试上限
  const upd = await execute(
    `UPDATE sms_codes SET attempts = attempts + 1 WHERE ${cond} AND attempts < ? AND expires_at > ?`,
    [...params, MAX_ATTEMPTS, now],
  )
  if (!upd?.meta?.changes) {
    // 已过期、已锁定或无记录：清理失效行
    await execute(`DELETE FROM sms_codes WHERE ${cond} AND (expires_at <= ? OR attempts >= ?)`, [...params, now, MAX_ATTEMPTS]).catch(() => {})
    return false
  }
  const entry = await queryOne<{ code_hash: string }>(`SELECT code_hash FROM sms_codes WHERE ${cond}`, params)
  if (!entry) return false
  if (hashCode(code) === entry.code_hash) {
    // 验证通过：立即删除防重放
    await execute(`DELETE FROM sms_codes WHERE ${cond}`, params)
    return true
  }
  return false
}

async function deliverCode(
  phone: string,
  code: string,
  config: SmsConfig | null,
  templateCode?: string
): Promise<boolean> {
  if (!config || !config.provider || !templateCode) return false
  try {
    const result = await sendSms(
      { phone, templateCode, templateParams: { code } },
      config
    )
    return !!result.success
  } catch (err) {
    console.warn('[SMS] deliverCode 发送异常:', err instanceof Error ? err.message : err)
    return false
  }
}
