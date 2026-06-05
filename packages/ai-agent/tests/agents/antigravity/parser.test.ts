import { describe, it, expect } from 'vitest'
import { parseAntigravityOutput } from '../../../src/agents/antigravity/parser.js'

describe('parseAntigravityOutput', () => {
  it('returns nothing for empty output', () => {
    expect(parseAntigravityOutput('   \n')).toEqual({ events: [] })
  })

  it('parses a single flat JSON result object with session id and usage', () => {
    const out = parseAntigravityOutput(
      JSON.stringify({
        result: 'Here is the answer.',
        conversation_id: 'conv-1',
        usage: { input_tokens: 10, output_tokens: 5 },
        finish_reason: 'stop',
      }),
    )
    expect(out.sessionId).toBe('conv-1')
    expect(out.finishReason).toBe('stop')
    expect(out.usageRaw).toEqual({ input_tokens: 10, output_tokens: 5 })
    expect(out.events).toEqual([{ kind: 'partial', text: 'Here is the answer.' }])
  })

  it('parses Anthropic-style stream-json lines into text and tool events', () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-9' }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Reading file' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 't1', name: 'read', input: { path: 'a.txt' } }] },
      }),
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: false }] },
      }),
      JSON.stringify({ type: 'result', subtype: 'success', usage: { output_tokens: 3 } }),
    ].join('\n')

    const out = parseAntigravityOutput(lines)
    expect(out.sessionId).toBe('sess-9')
    expect(out.events).toEqual([
      { kind: 'partial', text: 'Reading file' },
      { kind: 'tool_call', name: 'read', args: { path: 'a.txt' } },
      { kind: 'tool_result', name: 't1', result: 'ok', isError: false },
    ])
    expect(out.finishReason).toBe('success')
    expect(out.usageRaw).toEqual({ output_tokens: 3 })
  })

  it('falls back to plain text when stdout is not JSON', () => {
    const out = parseAntigravityOutput('just a plain answer\n')
    expect(out.events).toEqual([{ kind: 'partial', text: 'just a plain answer' }])
    expect(out.sessionId).toBeUndefined()
  })

  it('treats a JSON array as a sequence of events', () => {
    const out = parseAntigravityOutput(
      JSON.stringify([
        { type: 'assistant', message: { content: [{ type: 'text', text: 'a' }] } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'b' }] } },
      ]),
    )
    expect(out.events).toEqual([
      { kind: 'partial', text: 'a' },
      { kind: 'partial', text: 'b' },
    ])
  })
})
