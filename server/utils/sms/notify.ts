import { buildSmsConfig, sendSms } from './index'
import { loadSmsSettings } from '../smsSettings'

export type NotifyKind = 'balance' | 'count' | 'points'

const ENABLED_FIELDS: Record<NotifyKind, string> = {
  balance: 'sms_enabled_balance',
  count: 'sms_enabled_count',
  points: 'sms_enabled_points',
}

const TEMPLATE_FIELDS: Record<NotifyKind, string> = {
  balance: 'sms_template_balance',
  count: 'sms_template_count',
  points: 'sms_template_points',
}

async function loadSettingsRow(): Promise<any> {
  // 短信全局共享：读单例表 sms_settings，不分店
  return await loadSmsSettings()
}

export async function notifyMember(
  storeId: number,
  phone: string | null | undefined,
  kind: NotifyKind,
  params: Record<string, string>
): Promise<void> {
  try {
    if (!phone || !storeId) return
    const row = await loadSettingsRow()
    if (!row || !Number(row[ENABLED_FIELDS[kind]])) return
    const templateCode = row[TEMPLATE_FIELDS[kind]]
    const config = buildSmsConfig(row)
    if (!templateCode || !config) return
    const result = await sendSms({ phone, templateCode, templateParams: params }, config)
    if (!result.success) console.warn(`[SMS] ${kind} 通知发送失败:`, result.error)
  } catch (err) {
    console.warn(`[SMS] ${kind} 通知发送异常:`, err)
  }
}

export function notifyInBackground(
  event: any,
  storeId: number,
  phone: string | null | undefined,
  kind: NotifyKind,
  params: Record<string, string>
): void {
  const task = notifyMember(storeId, phone, kind, params)
  try {
    const ctx = event?.context?.cloudflare?.ctx
    if (ctx?.waitUntil) {
      ctx.waitUntil(task)
      return
    }
  } catch {}
  task.catch(() => {})
}
