function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&')
}

function truncateBytes(s: string, max: number): string {
  const bytes = new TextEncoder().encode(s)
  if (bytes.length <= max) return s
  let end = max
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1
  let out = new TextDecoder().decode(bytes.slice(0, end))
  if (out.endsWith('\\')) out = out.slice(0, -1)
  return out
}

export function prefixLike(s: string): string {
  return truncateBytes(escapeLike(s), 49) + '%'
}

export function containsLike(s: string): string {
  return '%' + truncateBytes(escapeLike(s), 48) + '%'
}
