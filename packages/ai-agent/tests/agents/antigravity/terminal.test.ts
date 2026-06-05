import { describe, it, expect } from 'vitest'
import { stripTerminalSequences } from '../../../src/agents/antigravity/terminal.js'

const ESC = '\x1b'
const BEL = '\x07'
const SETUP = `${ESC}[?9001h${ESC}[?1004h${ESC}[?25l${ESC}[2J${ESC}[m${ESC}[H`
const TEARDOWN = `${ESC}]0;C:\\Users\\me\\AppData\\Local\\agy\\bin\\agy.exe${BEL}${ESC}[?25h`

describe('stripTerminalSequences', () => {
  it('extracts plain text from real agy print-mode PTY output (single line)', () => {
    expect(stripTerminalSequences(`${SETUP}PONG\r\n${TEARDOWN}`)).toBe('PONG')
  })

  it('extracts a multi-line answer and drops the OSC title sequence', () => {
    const raw = `${SETUP}1. Red\r\n2. Blue\r\n3. Yellow\r\n${TEARDOWN}`
    expect(stripTerminalSequences(raw)).toBe('1. Red\n2. Blue\n3. Yellow')
  })

  it('leaves plain text untouched', () => {
    expect(stripTerminalSequences('just words')).toBe('just words')
  })

  it('returns empty string for control-only output', () => {
    expect(stripTerminalSequences(`${ESC}[2J${ESC}[H${ESC}[?25h`)).toBe('')
  })
})
