import { basename } from 'node:path'
import { STOP_WORDS } from './config.js'

const TOKEN_RE = /[A-Za-z0-9]+/g

export function stemTerm(token: string): string {
  // Light suffix stripping, no dependency. Applied identically at index and query
  // time so plural/inflected forms match. Order matters (longest suffixes first).
  for (const suffix of ['ing', 'ed', 'ly', 'es', 's']) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) {
      return token.slice(0, token.length - suffix.length)
    }
  }
  return token
}

export function normalizeTerms(text: string): string[] {
  const terms: string[] = []
  const matches = text.toLowerCase().match(TOKEN_RE) ?? []
  for (const token of matches) {
    if (token.length < 3) continue
    if (STOP_WORDS.has(token)) continue
    const stemmed = stemTerm(token)
    if (STOP_WORDS.has(stemmed)) continue
    terms.push(stemmed)
  }
  return terms
}

export function estimateTokens(text: string): number {
  const wordCount = (text.match(/\S+/g) ?? []).length
  return Math.max(1, Math.trunc(wordCount * 1.3))
}

export function cleanHeading(line: string): string | null {
  const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)
  if (!match) return null
  const heading = match[1].trim()
  return heading || null
}

export function titleFromText(path: string, text: string): string {
  for (const line of text.split('\n')) {
    const heading = cleanHeading(line)
    if (heading) return heading
  }
  return basename(path)
}
