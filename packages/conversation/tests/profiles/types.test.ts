import { describe, it, expect } from 'vitest'
import { ProfileConfigSchema, ProfileSchema } from '../../src/profiles/types.js'

describe('ProfileConfigSchema', () => {
  it('accepts a minimal claude config', () => {
    const r = ProfileConfigSchema.safeParse({ agent: 'claude' })
    expect(r.success).toBe(true)
  })

  it('rejects an unknown agent', () => {
    const r = ProfileConfigSchema.safeParse({ agent: 'gpt' })
    expect(r.success).toBe(false)
  })

  it('accepts the full bundle', () => {
    const r = ProfileConfigSchema.safeParse({
      agent: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      appendSystemPrompt: 'be careful',
      env: { FOO: 'bar' },
      enabledSkills: ['cron-helper'],
      disabledBuiltinSkills: ['xlsx'],
    })
    expect(r.success).toBe(true)
  })
})

describe('ProfileSchema', () => {
  it('requires source to be builtin or user', () => {
    const base = {
      id: 'p1', name: 'X', source: 'foo' as unknown as 'builtin',
      config: { agent: 'claude' as const },
      sortOrder: 0, createdAt: 1, updatedAt: 1,
    }
    expect(ProfileSchema.safeParse(base).success).toBe(false)
  })
})
