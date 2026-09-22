import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto'

const PREFIX = 'pbkdf2'
const ALGO = 'sha256'
const ITERATIONS = 100000
const KEYLEN = 32
const SALTLEN = 16

function pbkdf2Async(password: string, salt: Buffer, iterations: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, iterations, keylen, ALGO, (err, derived) => {
      if (err) reject(err)
      else resolve(derived)
    })
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALTLEN)
  const hash = await pbkdf2Async(String(password), salt, ITERATIONS, KEYLEN)
  return `${PREFIX}$${ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const s = String(stored)
  if (!s.startsWith(`${PREFIX}$`)) return false
  const parts = s.split('$')
  if (parts.length !== 4 || parts[0] !== PREFIX) return false
  const iterations = Number(parts[1])
  const salt = Buffer.from(parts[2], 'base64')
  const hash = Buffer.from(parts[3], 'base64')
  if (!Number.isFinite(iterations) || iterations <= 0 || salt.length === 0 || hash.length === 0) return false
  const computed = await pbkdf2Async(String(password), salt, iterations, hash.length)
  if (computed.length !== hash.length) return false
  return timingSafeEqual(computed, hash)
}
