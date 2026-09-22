import { useApiFetch } from './useApiFetch'

export interface IdempotentSubmitOptions {
  slot: string
  fingerprint: () => string
  timeoutMs?: number
}

export class TimeoutError extends Error {
  isTimeout = true
  constructor(message = '网络超时，可重新提交，系统会自动避免重复') {
    super(message)
  }
}

export function useIdempotentSubmit(opts: IdempotentSubmitOptions) {
  const key = ref('')

  function gen(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    return 'idem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12)
  }

  function getOrCreate(): string {
    if (key.value) return key.value
    const fp = opts.fingerprint()
    try {
      const raw = sessionStorage.getItem(opts.slot)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && parsed.fingerprint === fp && parsed.key) {
          key.value = parsed.key
          return parsed.key
        }
      }
    } catch {}
    const k = gen()
    key.value = k
    try { sessionStorage.setItem(opts.slot, JSON.stringify({ fingerprint: fp, key: k })) } catch {}
    return k
  }

  function reset(): void {
    key.value = gen()
    try {
      sessionStorage.setItem(opts.slot, JSON.stringify({ fingerprint: opts.fingerprint(), key: key.value }))
    } catch {}
  }

  function clear(): void {
    key.value = ''
    try { sessionStorage.removeItem(opts.slot) } catch {}
  }

  async function post<T = any>(url: string, body: Record<string, any> = {}): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000)
    try {
      const res = await useApiFetch<T>(url, {
        method: 'POST',
        body: { ...body, idempotency_key: getOrCreate() },
        signal: controller.signal,
      })
      clearTimeout(timer)
      return res
    } catch (e: any) {
      clearTimeout(timer)
      if (e?.name === 'AbortError' || e?.code === 'ABORT_ERR' || controller.signal.aborted) {
        throw new TimeoutError()
      }
      const status = e?.statusCode ?? e?.response?.status ?? e?.data?.statusCode
      if (status && status >= 400 && status < 500) clear()
      throw e
    }
  }

  return { key, getOrCreate, reset, clear, post }
}
