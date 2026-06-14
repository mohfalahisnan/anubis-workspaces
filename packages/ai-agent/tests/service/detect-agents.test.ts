import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { detectAgents, __test__pickBestPath } from '../../src/service/detect-agents.js'

const ORIG_ENV = { ...process.env }

beforeEach(() => {
  delete process.env.ANUBIS_CLAUDE_COMMAND
  delete process.env.ANUBIS_CODEX_COMMAND
  delete process.env.ANUBIS_ANTIGRAVITY_COMMAND
  delete process.env.QODER_PERSONAL_ACCESS_TOKEN
})

afterEach(() => {
  process.env = { ...ORIG_ENV }
})

describe('detectAgents', () => {
  it('reports env-override source when ANUBIS_CLAUDE_COMMAND is set', () => {
    process.env.ANUBIS_CLAUDE_COMMAND = '/custom/path/claude'
    const r = detectAgents()
    expect(r.claude).toEqual({
      available: true,
      path: '/custom/path/claude',
      source: 'env-override',
    })
  })

  it('reports env-override source when ANUBIS_CODEX_COMMAND is set', () => {
    process.env.ANUBIS_CODEX_COMMAND = '/custom/path/codex'
    const r = detectAgents()
    expect(r.codex.source).toBe('env-override')
    expect(r.codex.available).toBe(true)
  })

  it('reports env-override source when ANUBIS_ANTIGRAVITY_COMMAND is set', () => {
    process.env.ANUBIS_ANTIGRAVITY_COMMAND = '/custom/path/agy'
    const r = detectAgents()
    expect(r.antigravity).toEqual({
      available: true,
      path: '/custom/path/agy',
      source: 'env-override',
    })
  })

  it('returns a well-formed result for all agents when no env override is set', () => {
    const r = detectAgents()
    expect(r.claude.source).toBe('detected')
    expect(r.codex.source).toBe('detected')
    expect(r.antigravity.source).toBe('detected')
    expect(typeof r.claude.available).toBe('boolean')
    expect(typeof r.codex.available).toBe('boolean')
    expect(typeof r.antigravity.available).toBe('boolean')
  })
})

describe('pickBestPath (Windows shim ranking)', () => {
  it('prefers .cmd over the extension-less Unix shim that ENOENTs', () => {
    // This is the exact `where.exe codex` output that caused the
    // ENOENT bug: Unix shim first, .cmd second.
    const stdout = [
      'C:\\Users\\User\\AppData\\Roaming\\npm\\codex',
      'C:\\Users\\User\\AppData\\Roaming\\npm\\codex.cmd',
    ].join('\r\n')
    // Force the Windows branch regardless of host OS.
    expect(__test__pickBestPath(stdout, true)).toBe(
      'C:\\Users\\User\\AppData\\Roaming\\npm\\codex.cmd',
    )
  })

  it('returns the only entry when where.exe finds one path', () => {
    expect(__test__pickBestPath('C:\\bin\\claude.exe', true)).toBe('C:\\bin\\claude.exe')
  })

  it('on non-Windows takes the first which result verbatim', () => {
    const stdout = '/usr/local/bin/codex\n/opt/homebrew/bin/codex'
    expect(__test__pickBestPath(stdout, false)).toBe('/usr/local/bin/codex')
  })

  it('prefers .exe over .ps1 and extension-less', () => {
    const stdout = ['C:\\bin\\thing', 'C:\\bin\\thing.ps1', 'C:\\bin\\thing.exe'].join('\n')
    expect(__test__pickBestPath(stdout, true)).toBe('C:\\bin\\thing.exe')
  })
})
