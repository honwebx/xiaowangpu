import { execute, queryOne } from './db'

const MAX_FAILS = 5
const LOCK_MS = 5 * 60 * 1000
const FAIL_DECAY_MS = 30 * 60 * 1000
const SEND_IP_WINDOW_MS = 60 * 60 * 1000
const SEND_IP_MAX = 20

interface AttemptRow {
  fails: number
  lock_until: number
  updated_at: number
}

export function throttleKey(ip: string, phone: string, storeId: number | null): string {
  return `${ip}|${phone}|${storeId ?? ''}`
}

export function clientIp(event: any): string {
  return getHeader(event, 'cf-connecting-ip') || ''
}

export function sendCodeIpKey(ip: string): string {
  return `sendcode:${ip}`
}

async function loadRow(id: string): Promise<AttemptRow | null> {
  const row = await queryOne<AttemptRow>(
    'SELECT fails, lock_until, updated_at FROM login_attempts WHERE id = ?',
    [id],
  ).catch(() => null)
  return row || null
}

async function clearAttempt(id: string): Promise<void> {
  await execute('DELETE FROM login_attempts WHERE id = ?', [id]).catch(() => {})
}

export async function checkLoginAllowed(key: string): Promise<void> {
  const row = await loadRow(key)
  if (!row) return
  const now = Date.now()
  if (Number(row.lock_until) > now) {
    throw createError({ statusCode: 429, message: '尝试次数过多，请5分钟后再试' })
  }
  if (Number(row.lock_until) <= now && Number(row.fails) >= MAX_FAILS) {
    await clearAttempt(key)
    return
  }
  if (Number(row.lock_until) === 0 && Number(row.fails) > 0 && now - Number(row.updated_at) > FAIL_DECAY_MS) {
    await clearAttempt(key)
  }
}

export async function recordLoginFailure(key: string): Promise<void> {
  const now = Date.now()
  await execute(
    `INSERT INTO login_attempts (id, fails, lock_until, updated_at) VALUES (?, 1, 0, ?)
     ON CONFLICT(id) DO UPDATE SET
       fails = CASE WHEN login_attempts.lock_until <= ? AND login_attempts.fails >= ? THEN 1 ELSE login_attempts.fails + 1 END,
       lock_until = CASE WHEN (CASE WHEN login_attempts.lock_until <= ? AND login_attempts.fails >= ? THEN 1 ELSE login_attempts.fails + 1 END) >= ? THEN ? ELSE 0 END,
       updated_at = ?`,
    [key, now, now, MAX_FAILS, now, MAX_FAILS, MAX_FAILS, now + LOCK_MS, now],
  ).catch(() => {})
}

export async function resetLoginThrottle(key: string): Promise<void> {
  await clearAttempt(key)
}

export async function checkSendCodeAllowed(ip: string): Promise<void> {
  if (!ip) return
  const row = await loadRow(sendCodeIpKey(ip))
  if (!row) return
  const now = Date.now()
  if (now - Number(row.updated_at) > SEND_IP_WINDOW_MS) {
    await clearAttempt(sendCodeIpKey(ip))
    return
  }
  if (Number(row.fails) >= SEND_IP_MAX) {
    throw createError({ statusCode: 429, message: '该网络发送过于频繁，请稍后再试' })
  }
}

export async function recordSendCode(ip: string): Promise<void> {
  if (!ip) return
  const now = Date.now()
  await execute(
    `INSERT INTO login_attempts (id, fails, lock_until, updated_at) VALUES (?, 1, 0, ?)
     ON CONFLICT(id) DO UPDATE SET
       fails = CASE WHEN login_attempts.updated_at <= ? THEN 1 ELSE login_attempts.fails + 1 END,
       updated_at = CASE WHEN login_attempts.updated_at <= ? THEN ? ELSE login_attempts.updated_at END`,
    [sendCodeIpKey(ip), now, now - SEND_IP_WINDOW_MS, now - SEND_IP_WINDOW_MS, now],
  ).catch(() => {})
}
