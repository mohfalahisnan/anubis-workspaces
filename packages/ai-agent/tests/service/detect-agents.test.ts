import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { detectAgents } from '../../src/service/detect-agents.js'

const ORIG_ENV = { ...process.env }

beforeEach(() => {
  delete process.env.ANUBIS_CLAUDE_COMMAND
  delete process.env.ANUBIS_CODEX_COMMAND
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

  it('returns a well-formed result for both agents when no env override is set', () => {
    const r = detectAgents()
    expect(r.claude.source).toBe('detected')
    expect(r.codex.source).toBe('detected')
    expect(typeof r.claude.available).toBe('boolean')
    expect(typeof r.codex.available).toBe('boolean')
  })
})
