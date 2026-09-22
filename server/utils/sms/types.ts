export interface SmsConfig {
  provider: string
  accessKey: string
  secret: string
  signName: string
  sdkAppId?: string
  region?: string
  templates: Record<string, string>
}
export interface SmsParams {
  phone: string
  templateCode: string
  templateParams: Record<string, string>
}
export interface SmsResult {
  success: boolean
  messageId?: string
  error?: string
}
export interface SmsProvider {
  readonly name: string
  send(params: SmsParams, config: SmsConfig): Promise<SmsResult>
}
