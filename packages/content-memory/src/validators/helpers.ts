/**
 * Heuristic: parse "avoid/no/never/don't use X" rules and return the X phrases
 * that appear (case-insensitive) in the output. Deterministic MVP check — meant
 * to catch obvious violations, not replace an LLM judge.
 */
export function forbiddenPhraseViolations(rules: string[], output: string): string[] {
  const out = output.toLowerCase()
  const hits = new Set<string>()
  for (const rule of rules) {
    const m = rule.match(/(?:never use|never|avoid|do not use|don['’]?t use|no)\s+(.+)/i)
    const phrase = (m?.[1] ?? '').trim().replace(/[.?!]+$/, '')
    if (phrase.length >= 3 && out.includes(phrase.toLowerCase())) hits.add(phrase)
  }
  return [...hits]
}
