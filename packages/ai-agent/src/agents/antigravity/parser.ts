import type { AntigravityContentBlock, AntigravityJson } from './types.js'

/** A normalized event extracted from `agy` output, ready to re-emit. */
export type AntigravityEvent =
  | { kind: 'partial'; text: string }
  | { kind: 'tool_call'; name: string; args: unknown }
  | { kind: 'tool_result'; name: string; result: unknown; isError: boolean }

export interface ParsedAntigravityOutput {
  events: AntigravityEvent[]
  sessionId?: string
  usageRaw?: unknown
  finishReason?: string
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function sessionIdOf(o: AntigravityJson): string | undefined {
  return o.conversation_id ?? o.conversationId ?? o.session_id ?? o.sessionId
}

function isContentBlocks(content: unknown): content is AntigravityContentBlock[] {
  return Array.isArray(content)
}

/** Consume one parsed JSON object, pushing events / metadata into `out`. */
function ingest(obj: AntigravityJson, out: ParsedAntigravityOutput): void {
  const sid = sessionIdOf(obj)
  if (sid) out.sessionId = sid
  if (obj.usage !== undefined) out.usageRaw = obj.usage
  if (obj.finish_reason || obj.stop_reason || obj.subtype) {
    out.finishReason = obj.finish_reason ?? obj.stop_reason ?? obj.subtype
  }

  // Anthropic-style stream-json: assistant / user messages carry content blocks.
  const content = obj.message?.content
  if (isContentBlocks(content)) {
    for (const c of content) {
      if (c.type === 'text' && typeof c.text === 'string') {
        out.events.push({ kind: 'partial', text: c.text })
      } else if (c.type === 'tool_use' && c.name) {
        out.events.push({ kind: 'tool_call', name: c.name, args: c.input })
      } else if (c.type === 'tool_result') {
        out.events.push({
          kind: 'tool_result',
          name: c.tool_use_id ?? 'tool',
          result: c.content,
          isError: c.is_error === true,
        })
      }
    }
    return
  }

  // Flat shapes: a single `result` / `text` / `delta` string.
  const flat = obj.result ?? obj.text ?? obj.response ?? obj.output ?? obj.delta
  if (typeof flat === 'string' && flat !== '') {
    out.events.push({ kind: 'partial', text: flat })
  } else if (typeof content === 'string' && content !== '') {
    out.events.push({ kind: 'partial', text: content })
  }
}

/**
 * Parse `agy` print-mode stdout. Handles, in order of preference:
 *   1. a single JSON object (`agy -p … --output-format json`),
 *   2. JSON Lines / stream-json (one object per line),
 *   3. plain text — emitted verbatim as a single partial.
 */
export function parseAntigravityOutput(stdout: string): ParsedAntigravityOutput {
  const out: ParsedAntigravityOutput = { events: [] }
  const trimmed = stdout.trim()
  if (!trimmed) return out

  // (1) whole blob is a single JSON object.
  const whole = tryParse(trimmed)
  if (whole && typeof whole === 'object' && !Array.isArray(whole)) {
    ingest(whole as AntigravityJson, out)
    if (out.events.length > 0 || out.sessionId) return out
  }

  // (1b) whole blob is a JSON array of events.
  if (Array.isArray(whole)) {
    for (const item of whole) {
      if (item && typeof item === 'object') ingest(item as AntigravityJson, out)
    }
    if (out.events.length > 0 || out.sessionId) return out
  }

  // (2) JSON Lines.
  const lines = trimmed.split(/\r?\n/)
  let anyJson = false
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    const parsed = tryParse(t)
    if (parsed && typeof parsed === 'object') {
      anyJson = true
      ingest(parsed as AntigravityJson, out)
    }
  }
  if (anyJson && (out.events.length > 0 || out.sessionId)) return out

  // (3) plain text.
  out.events = [{ kind: 'partial', text: stdout.replace(/\s+$/, '') }]
  return out
}
