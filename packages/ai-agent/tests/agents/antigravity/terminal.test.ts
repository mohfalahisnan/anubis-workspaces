import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { renderTerminalOutput, diffAppended } from '../../../src/agents/antigravity/terminal.js'

const ESC = '\x1b'
const BEL = '\x07'
const SETUP = `${ESC}[?25l${ESC}[2J${ESC}[m${ESC}[H`
const TEARDOWN = `${ESC}]0;C:\\Users\\me\\AppData\\Local\\agy\\bin\\agy.exe${BEL}${ESC}[?25h`

describe('renderTerminalOutput — screen emulation', () => {
  it('extracts a plain single-line answer', () => {
    expect(renderTerminalOutput(`${SETUP}4\r\n${TEARDOWN}`)).toBe('4')
  })

  it('keeps literal CRLF-separated lines', () => {
    const raw = `${SETUP}- Red\r\n- Yellow\r\n- Blue\r\n${TEARDOWN}`
    expect(renderTerminalOutput(raw)).toBe('- Red\n- Yellow\n- Blue')
  })

  it('renders ESC[<n>C (cursor-forward) as spaces, not deletion', () => {
    // agy emits a run of spaces as a cursor-forward escape.
    expect(renderTerminalOutput(`${SETUP}Hello,${ESC}[1CWorld`)).toBe('Hello, World')
  })

  it('renders ESC[<n>C even when an OSC title interrupts mid-word', () => {
    // Real shape from the code-block capture: space + title + show-cursor split a word.
    const raw = `${SETUP}print("Hello,${ESC}[1C${TEARDOWN}World!")`
    expect(renderTerminalOutput(raw)).toBe('print("Hello, World!")')
  })

  it('renders ESC[<row>;<col>H (cursor-position) as line breaks', () => {
    // Jumping from row 1 to row 3 yields one blank line between (a paragraph break).
    const raw = `${SETUP}following file:${ESC}[3;1H* item`
    expect(renderTerminalOutput(raw)).toBe('following file:\n\n* item')
  })

  it('drops the OSC window-title sequence', () => {
    expect(renderTerminalOutput(`${SETUP}hi${ESC}]0;some title${BEL}${ESC}[?25h`)).toBe('hi')
  })

  it('returns empty string for control-only output', () => {
    expect(renderTerminalOutput(`${ESC}[2J${ESC}[H${ESC}[?25h`)).toBe('')
  })

  it('leaves plain text untouched', () => {
    expect(renderTerminalOutput('just words')).toBe('just words')
  })
})

describe('diffAppended — streaming delta over re-rendered screens', () => {
  it('returns the appended suffix when text only grows', () => {
    expect(diffAppended('abc', 'abcdef')).toBe('def')
  })

  it('returns the whole string when prev is empty', () => {
    expect(diffAppended('', 'hello')).toBe('hello')
  })

  it('returns empty string when unchanged', () => {
    expect(diffAppended('abc', 'abc')).toBe('')
  })

  it('returns the divergent tail when a later render repaints earlier text', () => {
    expect(diffAppended('foo bar', 'foo BAZ')).toBe('BAZ')
  })
})

describe('renderTerminalOutput — real agy v1.0.7 captures', () => {
  const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'agy-raw')
  const load = (name: string): string =>
    JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')).raw as string

  it('has fixtures to assert against', () => {
    const files = readdirSync(fixturesDir).filter((f) => f.endsWith('.json'))
    expect(files.length).toBeGreaterThanOrEqual(11)
  })

  it('restores the space inside the code block (03)', () => {
    const out = renderTerminalOutput(load('03-code-block.json'))
    expect(out).toContain('print("Hello, World!")')
    expect(out).not.toContain('Hello,World!')
  })

  it('restores the paragraph break before the summary (05)', () => {
    const out = renderTerminalOutput(load('05-tool-read.json'))
    expect(out).toContain('**pineapple**.\n\n### Summary of Work')
    expect(out).not.toContain('**pineapple**.### Summary')
  })

  it('restores the line break before the bullet (06)', () => {
    const out = renderTerminalOutput(load('06-tool-listdir.json'))
    expect(out).toContain('following file:\n\n*')
    expect(out).not.toContain('following file:*')
  })

  it('restores the break before the confirmation (07)', () => {
    const out = renderTerminalOutput(load('07-tool-write.json'))
    expect(out).toContain('`banana`.\n\nThe task is completed.')
    expect(out).not.toContain('`banana`.The task')
  })

  it('restores both CUP breaks in the streamed answer (08)', () => {
    const out = renderTerminalOutput(load('08-error-bad-model.json'))
    expect(out).toContain('assistant.\n\nI see we have two files')
    expect(out).toContain('pineapple.`)\n\nHow can I help you today?')
    expect(out).not.toContain('today?How')
  })
})
