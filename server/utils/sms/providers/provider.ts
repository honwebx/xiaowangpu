import type { SmsProvider } from '../types'
const providers = new Map<string, SmsProvider>()
export function registerProvider(p: SmsProvider) { providers.set(p.name, p) }
export function getProvider(name: string): SmsProvider | undefined { return providers.get(name) }
