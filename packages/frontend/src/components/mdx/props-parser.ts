export type ParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: string }

/**
 * Parse the prop string from an MDX component opening tag.
 * Grammar: zero or more `name="string"` | `name={json-value}` separated by whitespace.
 * Strings use double quotes only. JSON values are parsed by JSON.parse after braces stripped.
 */
export function parseProps(raw: string): ParseResult {
  const value: Record<string, unknown> = {}
  let i = 0
  const n = raw.length

  const skipWs = () => {
    while (i < n && /\s/.test(raw[i]!)) i++
  }

  while (true) {
    skipWs()
    if (i >= n) return { ok: true, value }

    const idStart = i
    if (!/[A-Za-z_$]/.test(raw[i]!)) {
      return { ok: false, reason: `expected prop name at ${i}` }
    }
    i++
    while (i < n && /[\w$]/.test(raw[i]!)) i++
    const name = raw.slice(idStart, i)

    if (raw[i] !== '=') {
      return { ok: false, reason: `expected '=' after '${name}' at ${i}` }
    }
    i++

    if (raw[i] === '"') {
      const sStart = i
      i++
      while (i < n && raw[i] !== '"') {
        if (raw[i] === '\\' && i + 1 < n) i += 2
        else i++
      }
      if (i >= n) {
        return { ok: false, reason: `unterminated string for prop '${name}'` }
      }
      i++
      try {
        value[name] = JSON.parse(raw.slice(sStart, i))
      } catch (err) {
        return { ok: false, reason: `invalid string for '${name}': ${(err as Error).message}` }
      }
    } else if (raw[i] === '{') {
      const eStart = i + 1
      let depth = 1
      let j = i + 1
      while (j < n && depth > 0) {
        const c = raw[j]
        if (c === '"') {
          j++
          while (j < n && raw[j] !== '"') {
            if (raw[j] === '\\' && j + 1 < n) j += 2
            else j++
          }
          if (j >= n) return { ok: false, reason: `unterminated string inside braces for '${name}'` }
          j++
        } else if (c === '{') {
          depth++
          j++
        } else if (c === '}') {
          depth--
          j++
        } else {
          j++
        }
      }
      if (depth !== 0) {
        return { ok: false, reason: `unbalanced braces for prop '${name}'` }
      }
      const expr = raw.slice(eStart, j - 1)
      try {
        value[name] = JSON.parse(expr)
      } catch (err) {
        return { ok: false, reason: `invalid JSON for prop '${name}': ${(err as Error).message}` }
      }
      i = j
    } else {
      return { ok: false, reason: `expected '"' or '{' after '=' for prop '${name}' at ${i}` }
    }
  }
}
