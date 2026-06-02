import type { StreamLine } from './types.js'

export function parseStreamLine(line: string): StreamLine | null {
  const t = line.trim()
  if (!t) return null
  try {
    return JSON.parse(t) as StreamLine
  } catch {
    return null
  }
}
