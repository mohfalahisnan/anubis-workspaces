import { renderTerminalOutput } from './terminal.js'

/**
 * A normalized event extracted from `agy` output.
 *
 * `agy` v1.0.7 print mode emits only plain rendered text (no JSON, no
 * machine-readable tool markers — see docs/antigravity/agy-output-reference.md),
 * so in practice only `partial` is produced. The `tool_*` variants are kept for
 * the emitter contract shared with the other agents but are currently dormant.
 */
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

/**
 * Turn a raw `agy` print-mode PTY buffer into a single assistant text event.
 *
 * The whole buffer is rendered by emulating the terminal screen, recovering the
 * spaces and line breaks that `agy` encodes as cursor-movement escapes. Empty /
 * control-only output yields no events. agy print mode surfaces no conversation
 * id, so `sessionId` is never set here (resume is driven by `--continue` /
 * `--conversation`).
 */
export function parseAntigravityOutput(raw: string): ParsedAntigravityOutput {
  const text = renderTerminalOutput(raw)
  return { events: text ? [{ kind: 'partial', text }] : [] }
}
