import { basename } from 'node:path'
import { STOP_WORDS } from './config.js'

const TOKEN_RE = /[A-Za-z0-9]+/g

// Doubled consonants kept intact when undoubling (Porter's exception set), so
// `falling`->`fall` and `pressing`->`press` rather than `fal`/`pres`.
const UNDOUBLE_KEEP = new Set(['l', 's', 'z'])

/**
 * Porter-style consonant undoubling. After a verb suffix is stripped, a word
 * left ending in a doubled consonant (other than l/s/z) drops one letter, so
 * `running`->`runn`->`run` and `hopped`->`hopp`->`hop` collapse onto the base.
 */
function undouble(stem: string): string {
  const n = stem.length
  if (n >= 2 && stem[n - 1] === stem[n - 2] && !UNDOUBLE_KEEP.has(stem[n - 1])) {
    return stem.slice(0, -1)
  }
  return stem
}

export function stemTerm(token: string): string {
  // Light, dependency-free English stemmer (a trimmed Porter step 1), applied
  // identically at index and query time so inflected forms collapse to one stem.
  // Verb suffixes first, then plurals; every rule keeps a >=3-char stem.

  // -ing / -ed (with undoubling), -ly: running->run, hopped->hop, quickly->quick.
  if (token.endsWith('ing') && token.length - 3 >= 3) return undouble(token.slice(0, -3))
  if (token.endsWith('ed') && token.length - 2 >= 3) return undouble(token.slice(0, -2))
  if (token.endsWith('ly') && token.length - 2 >= 3) return token.slice(0, -2)

  // Plurals: parties->party, classes/processes->class/process, boxes->box, cats->cat.
  // A word ending in "ss" is singular, so its trailing s/es is preserved
  // (class->class, process->process) — this is the singular/plural recall fix:
  // without it `class` stems to `clas` while `classes` stems to `class`.
  if (token.endsWith('ies') && token.length - 3 >= 2) return token.slice(0, -3) + 'y'
  if (token.endsWith('sses')) return token.slice(0, -2)
  if (token.endsWith('ss')) return token
  if (token.endsWith('es') && token.length - 2 >= 3) return token.slice(0, -2)
  if (token.endsWith('s') && token.length - 1 >= 3) return token.slice(0, -1)

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
