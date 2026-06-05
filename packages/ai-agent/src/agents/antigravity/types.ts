/**
 * Loose JSON shapes emitted by `agy --output-format json`.
 *
 * The Antigravity CLI (`agy`) is closely modelled on Claude Code's CLI and
 * its structured output is not formally specified, so every field here is
 * optional. The parser reads defensively and falls back to plain text when
 * stdout is not JSON at all.
 */

export interface AntigravityContentBlock {
  type?: string
  text?: string
  // tool_use
  id?: string
  name?: string
  input?: unknown
  // tool_result
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

export interface AntigravityMessage {
  content?: AntigravityContentBlock[] | string
}

/**
 * A single line of `--output-format json` / `stream-json` output, or the whole
 * blob when `agy` prints one JSON object. Anthropic-style (`type` of
 * `assistant` / `user` / `result` / `system`) and flat (`{ result, ... }`)
 * shapes are both tolerated.
 */
export interface AntigravityJson {
  type?: string
  subtype?: string
  // identifiers — any of these may carry the resumable conversation id
  conversation_id?: string
  conversationId?: string
  session_id?: string
  sessionId?: string
  // text payloads
  result?: string
  text?: string
  response?: string
  output?: string
  delta?: string
  message?: AntigravityMessage
  // metadata
  model?: string
  usage?: unknown
  total_cost_usd?: number
  stop_reason?: string
  finish_reason?: string
}
