import { randomBytes } from 'node:crypto'

export async function pinyinInitials(name: string): Promise<string> {
  const { pinyin } = await import('pinyin-pro')
  const arr = pinyin(String(name || ''), {
    pattern: 'first',
    type: 'array',
    toneType: 'none',
  }) as string[]
  const code = (arr || []).join('').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (code) return code
  // 拼音推导不出时使用 P + 4 位随机后缀，避免批量导入无中文名商品全部撞码
  return 'P' + randomBytes(2).toString('hex').toUpperCase()
}
