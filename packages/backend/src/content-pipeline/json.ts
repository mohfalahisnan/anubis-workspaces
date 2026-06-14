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
  /** Instruction used on repair attempts (overrides the default). */
  retryHint?: string
  /** Total attempts including the first (default 3 → 1 initial + 2 repairs). */
  maxAttempts?: number
}

function looksLikeAuthError(text: string): boolean {
  return /401|invalid authentication credentials|failed to authenticate|authentication failed/i.test(text)
}

/** Cap how much of the prior reply we echo back so the repair prompt stays bounded. */
const MAX_FEEDBACK_CHARS = 4000

const DEFAULT_REPAIR_HINT =
  'Your previous reply could not be parsed: it was malformed or got cut off before the JSON object was complete. '
  + 'Re-emit the COMPLETE response as exactly ONE valid JSON object — no prose, no markdown fence, with every string, '
  + 'array, and brace properly closed. If your previous reply was truncated, return a more concise version (shorter '
  + 'note/text fields) so the entire object fits in one response.'

/**
 * Build a repair follow-up that hands the agent its own malformed reply plus the
 * original instructions, so it can restructure/complete the output into valid JSON.
 * Each runner call is stateless, so the original prompt must be re-sent to carry
 * the schema context.
 */
function buildRepairPrompt(original: string, malformed: string, hint: string): string {
  const prev = malformed.trim().slice(0, MAX_FEEDBACK_CHARS)
  return [
    original,
    '',
    '--- YOUR PREVIOUS REPLY (INVALID JSON) ---',
    prev || '(empty response)',
    '--- END OF PREVIOUS REPLY ---',
    '',
    hint,
  ].join('\n')
}

/**
 * Best-effort repair of a JSON object that was cut off mid-stream (the model hit
 * its output limit). Closes an open string, drops a trailing comma or a dangling
 * `"key":` with no value, and closes any unbalanced braces/brackets. Returns the
 * repaired source string, or null when there's no object to repair. The result is
 * still validated by the caller, so an over-eager repair just fails validation
 * and falls through to the agent round-trip — it can't inject bad data silently.
 */
export function repairTruncatedJson(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  const closers: string[] = []
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
    else if (ch === '{') closers.push('}')
    else if (ch === '[') closers.push(']')
    else if (ch === '}' || ch === ']') closers.pop()
  }
  let body = text.slice(start)
  if (inString) body += '"' // close an unterminated string value
  body = body.replace(/[\s,]+$/, '') // drop trailing whitespace / comma
  // Drop a dangling object member whose value was cut off before it started
  // (e.g. `…,"pass":` or `{"pass":`). Requires the colon so real string array
  // elements (no colon) are preserved.
  body = body.replace(/,\s*"[^"]*"\s*:\s*$/, '').replace(/\{\s*"[^"]*"\s*:\s*$/, '{')
  body = body.replace(/[\s,]+$/, '')
  for (let i = closers.length - 1; i >= 0; i--) body += closers[i]
  return body
}

/** Parse + schema-validate, trying a truncation repair before giving up. */
function tryParse<T>(text: string, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: extractJson(text, schema) }
  } catch {
    const repaired = repairTruncatedJson(text)
    if (repaired) {
      try {
        return { ok: true, value: schema.parse(JSON.parse(repaired)) }
      } catch {
        // repair produced invalid/non-conforming JSON — fall through
      }
    }
    return { ok: false }
  }
}

/**
 * Run the agent and parse a schema-validated JSON object from its reply.
 *
 * If the reply isn't valid JSON (commonly a response truncated mid-object when
 * the model hits its output limit), recovery is automatic and transparent:
 * first a local repair of the truncated object, then — if that fails — the
 * agent's malformed reply is fed back with an instruction to re-emit the
 * complete, valid object, for up to `maxAttempts` total tries.
 */
export async function runStructured<T>(
  runner: StructuredRunner,
  opts: RunStructuredOpts<T>,
): Promise<T> {
  const hint = opts.retryHint ?? DEFAULT_REPAIR_HINT
  const maxAttempts = Math.max(2, opts.maxAttempts ?? 3)
  let lastText = ''
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const prompt = attempt === 0 ? opts.prompt : buildRepairPrompt(opts.prompt, lastText, hint)
    lastText = await runner(prompt)
    if (looksLikeAuthError(lastText)) {
      throw new Error(
        'Claude authentication failed (401). The selected profile is not signed in or its credentials are invalid. '
        + 'Open Profiles, sign in to the profile, then retry.',
      )
    }
    const parsed = tryParse(lastText, opts.schema)
    if (parsed.ok) return parsed.value
    // Malformed/truncated and unrepairable locally → loop to feed it back to the
    // agent for restructuring, or fall through to the error once attempts run out.
  }
  // Surface the agent's actual reply — when the agent errors (e.g. an auth failure) its
  // text IS the diagnostic, and a bare "Unexpected token" hides it.
  const snippet = lastText.trim().slice(0, 300)
  throw new Error(`AI step did not return valid JSON after ${maxAttempts} attempts. The agent replied: ${snippet || '(empty response)'}`)
}
