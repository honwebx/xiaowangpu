import { createHash, createHmac } from 'node:crypto'
import type { SmsConfig, SmsParams, SmsResult, SmsProvider } from '../types'
import { registerProvider } from './provider'

const HOST = 'sms.tencentcloudapi.com'
const SERVICE = 'sms'
const VERSION = '2021-01-11'
const DEFAULT_REGION = 'ap-guangzhou'

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

export const tencentProvider: SmsProvider = {
  name: 'tencent',
  async send(params: SmsParams, config: SmsConfig): Promise<SmsResult> {
    if (!config.accessKey || !config.secret || !config.signName || !config.sdkAppId) {
      return { success: false, error: '腾讯云短信配置不完整（SecretId/SecretKey/签名/SDKAppId）' }
    }
    const region = config.region || DEFAULT_REGION
    const timestamp = Math.floor(Date.now() / 1000)
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
    const payload = JSON.stringify({
      PhoneNumberSet: [`+86${params.phone}`],
      SignName: config.signName,
      SmsSdkAppId: config.sdkAppId,
      TemplateId: params.templateCode,
      TemplateParamSet: Object.values(params.templateParams || {}),
    })

    const canonicalRequest = [
      'POST',
      '/',
      '',
      `content-type:application/json; charset=utf-8\nhost:${HOST}\n`,
      'content-type;host',
      sha256Hex(payload),
    ].join('\n')

    const credentialScope = `${date}/${SERVICE}/tc3_request`
    const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), credentialScope, sha256Hex(canonicalRequest)].join('\n')
    const signature = hmac(hmac(hmac(hmac(`TC3${config.secret}`, date), SERVICE), 'tc3_request'), stringToSign).toString('hex')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10_000)
    let res: Response
    try {
      res = await fetch(`https://${HOST}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `TC3-HMAC-SHA256 Credential=${config.accessKey}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`,
          'X-TC-Action': 'SendSms',
          'X-TC-Timestamp': String(timestamp),
          'X-TC-Version': VERSION,
          'X-TC-Region': region,
        },
        body: payload,
        signal: controller.signal,
      })
    } catch (err: any) {
      clearTimeout(timeoutId)
      if (err?.name === 'AbortError') return { success: false, error: '腾讯云短信请求超时' }
      return { success: false, error: '腾讯云短信请求失败: ' + (err?.message || '未知错误') }
    }
    clearTimeout(timeoutId)
    const data: any = await res.json().catch(() => null)
    const resp = data?.Response
    if (resp?.Error) {
      return { success: false, error: `腾讯云短信失败: ${resp.Error.Code} ${resp.Error.Message}` }
    }
    const status = resp?.SendStatusSet?.[0]
    if (status?.Code === 'Ok') {
      return { success: true, messageId: status.SerialNo || resp.RequestId }
    }
    return { success: false, error: `腾讯云短信失败: ${status?.Code || `HTTP ${res.status}`} ${status?.Message || ''}`.trim() }
  },
}

registerProvider(tencentProvider)
