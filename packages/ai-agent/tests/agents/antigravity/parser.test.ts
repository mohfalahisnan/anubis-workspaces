import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseAntigravityOutput } from '../../../src/agents/antigravity/parser.js'

const ESC = '\x1b'
const SETUP = `${ESC}[?25l${ESC}[2J${ESC}[m${ESC}[H`

// agy v1.0.7 print mode emits plain rendered text only — never JSON. The parser
// turns the raw PTY buffer into a single assistant text event by emulating the
// terminal screen (see terminal.ts / docs/antigravity/agy-output-reference.md).
describe('parseAntigravityOutput', () => {
  it('returns no events for empty output', () => {
    expect(parseAntigravityOutput('   \n')).toEqual({ events: [] })
  })

  it('returns no events for control-only output', () => {
    expect(parseAntigravityOutput(`${ESC}[2J${ESC}[H${ESC}[?25h`)).toEqual({ events: [] })
  })

  it('emits the rendered answer as a single partial', () => {
    const out = parseAntigravityOutput(`${SETUP}The answer is 42.\r\n`)
    expect(out.events).toEqual([{ kind: 'partial', text: 'The answer is 42.' }])
    expect(out.sessionId).toBeUndefined()
  })

  it('restores cursor-forward spaces in the rendered text', () => {
    const out = parseAntigravityOutput(`${SETUP}Hello,${ESC}[1CWorld`)
    expect(out.events).toEqual([{ kind: 'partial', text: 'Hello, World' }])
  })

  it('restores cursor-position line breaks in the rendered text', () => {
    const out = parseAntigravityOutput(`${SETUP}intro:${ESC}[3;1H- item`)
    expect(out.events).toEqual([{ kind: 'partial', text: 'intro:\n\n- item' }])
  })

  it('renders a real multi-chunk capture into one accurate partial (03)', () => {
    const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'agy-raw')
    const raw = JSON.parse(
      readFileSync(join(fixturesDir, '03-code-block.json'), 'utf8'),
    ).raw as string
    const out = parseAntigravityOutput(raw)
    expect(out.events).toHaveLength(1)
    expect(out.events[0]).toMatchObject({ kind: 'partial' })
    expect((out.events[0] as { text: string }).text).toContain('print("Hello, World!")')
  })
})
