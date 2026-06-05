import { describe, it, expect } from 'vitest'
import { ValidationService } from '../../src/validators/validation-service.js'
import type { OutputValidator, ValidationResult } from '../../src/validators/types.js'
import type { ContentContextPack } from '../../src/context-pack/types.js'

function emptyPack(): ContentContextPack {
  return {
    workspaceId: 'ws-a', platform: 'instagram', taskType: 'generate_content', objective: 'o',
    brandContext: { brandSummary: '', toneOfVoice: [], audience: [], offers: [], constraints: [] },
    platformContext: { platform: 'instagram', formatRules: [], contentPatterns: [], algorithmNotes: [] },
    similarContent: { approved: [], competitor: [], rejected: [] },
    globalFrameworks: { hooks: [], copywritingPatterns: [], contentStructures: [], ctaPatterns: [] },
    workspaceRules: { mustFollow: [], mustAvoid: [], clientPreferences: [] },
    experienceMemory: { previousMistakes: [], reviewerFeedback: [], validationRules: [] },
    citations: [], finalInstruction: '',
  }
}

function fake(name: string, result: ValidationResult): OutputValidator {
  return { name, validate: async () => result }
}

describe('ValidationService', () => {
  it('passes when all validators pass', async () => {
    const svc = new ValidationService([
      fake('a', { passed: true, issues: [] }),
      fake('b', { passed: true, issues: [] }),
    ])
    const r = await svc.validate({ workspaceId: 'ws-a', platform: 'instagram', contextPack: emptyPack(), output: 'x' })
    expect(r.passed).toBe(true)
    expect(r.issues).toHaveLength(0)
  })

  it('aggregates issues and reports the max severity', async () => {
    const svc = new ValidationService([
      fake('a', { passed: false, severity: 'medium', issues: [{ type: 'platform_violation', message: 'm' }] }),
      fake('b', { passed: false, severity: 'critical', issues: [{ type: 'workspace_leakage', message: 'l' }] }),
    ])
    const r = await svc.validate({ workspaceId: 'ws-a', platform: 'instagram', contextPack: emptyPack(), output: 'x' })
    expect(r.passed).toBe(false)
    expect(r.issues).toHaveLength(2)
    expect(r.severity).toBe('critical')
  })
})
