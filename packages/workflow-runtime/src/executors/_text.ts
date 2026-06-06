/**
 * Pull the first renderable text out of an upstream map: a string value, or a
 * `text` string field on an object value. Shared by the Markdown display and
 * the Human Review pass-through so "the upstream text" means one thing.
 */
export function firstUpstreamText(upstream: Record<string, unknown>): string | null {
  for (const value of Object.values(upstream)) {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object') {
      const t = (value as { text?: unknown }).text
      if (typeof t === 'string') return t
    }
  }
  return null
}
