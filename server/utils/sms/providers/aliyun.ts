import { createHmac, randomUUID } from 'node:crypto'
import type { SmsConfig, SmsParams, SmsResult, SmsProvider } from '../types'
import { registerProvider } from './provider'

function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~')
}

export const aliyunProvider: SmsProvider = {
  name: 'aliyun',
  async send(params: SmsParams, config: SmsConfig): Promise<SmsResult> {
    if (!config.accessKey || !config.secret || !config.signName) {
      return { success: false, error: '阿里云短信配置不完整（AccessKey/Secret/签名）' }
    }
    const all: Record<string, string> = {
      Action: 'SendSms',
      Version: '2017-05-25',
      Format: 'JSON',
      RegionId: 'cn-hangzhou',
      AccessKeyId: config.accessKey,
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: randomUUID(),
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      PhoneNumbers: params.phone,
      SignName: config.signName,
      TemplateCode: params.templateCode,
      TemplateParam: JSON.stringify(params.templateParams || {}),
    }
    const canonical = Object.keys(all)
      .sort()
      .map((k) => `${percentEncode(k)}=${percentEncode(all[k])}`)
      .join('&')
    const stringToSign = `POST&%2F&${percentEncode(canonical)}`
    const signature = createHmac('sha1', `${config.secret}&`).update(stringToSign).digest('base64')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10_000)
    let res: Response
    try {
      res = await fetch('https://dysmsapi.aliyuncs.com/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', Accept: 'application/json' },
        body: new URLSearchParams({ ...all, Signature: signature }).toString(),
        signal: controller.signal,
      })
    } catch (err: any) {
      clearTimeout(timeoutId)
      if (err?.name === 'AbortError') return { success: false, error: '阿里云短信请求超时' }
      return { success: false, error: '阿里云短信请求失败: ' + (err?.message || '未知错误') }
    }
    clearTimeout(timeoutId)
    const data: any = await res.json().catch(() => null)
    if (data?.Code === 'OK') {
      return { success: true, messageId: data.BizId || data.RequestId }
    }
    return { success: false, error: `阿里云短信失败: ${data?.Code || `HTTP ${res.status}`} ${data?.Message || ''}`.trim() }
  },
}

registerProvider(aliyunProvider)
