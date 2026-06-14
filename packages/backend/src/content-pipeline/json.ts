import type { z } from 'zod'

/** A minimal agent runner: takes a prompt, returns the agent's final text. */
export type StructuredRunner = (prompt: string) => Promise<string>

/** Find the first balanced {...} object substring, ignoring braces inside strings. */
function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export function extractJson<T>(text: string, schema: z.ZodType<T>): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1]!.trim() : (firstJsonObject(text) ?? text.trim())
  const obj = firstJsonObject(candidate) ?? candidate
  return schema.parse(JSON.parse(obj))
}

export interface RunStructuredOpts<T> {
  prompt: string
  schema: z.ZodType<T>
  /** Extra instruction appended on the retry attempt. */
  retryHint?: string
}

export async function runStructured<T>(
  runner: StructuredRunner,
  opts: RunStructuredOpts<T>,
): Promise<T> {
  try {
    return extractJson(await runner(opts.prompt), opts.schema)
  } catch {
    const hint = opts.retryHint
      ?? 'Your previous reply was not valid JSON. Reply with ONLY a single JSON object, no prose, no code fence.'
    const retryPrompt = `${opts.prompt}\n\n${hint}`
    return extractJson(await runner(retryPrompt), opts.schema)
  }
}
