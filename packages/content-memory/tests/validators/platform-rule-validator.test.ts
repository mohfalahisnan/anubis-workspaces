import { describe, it, expect } from 'vitest'
import { PlatformRuleValidator } from '../../src/validators/platform-rule-validator.js'
import type { ContentContextPack } from '../../src/context-pack/types.js'

function pack(formatRules: string[]): ContentContextPack {
  return {
    workspaceId: 'ws-a', platform: 'instagram', taskType: 'generate_content', objective: 'o',
    brandContext: { brandSummary: '', toneOfVoice: [], audience: [], offers: [], constraints: [] },
    platformContext: { platform: 'instagram', formatRules, contentPatterns: [], algorithmNotes: [] },
    similarContent: { approved: [], competitor: [], rejected: [] },
    globalFrameworks: { hooks: [], copywritingPatterns: [], contentStructures: [], ctaPatterns: [] },
    workspaceRules: { mustFollow: [], mustAvoid: [], clientPreferences: [] },
    experienceMemory: { previousMistakes: [], reviewerFeedback: [], validationRules: [] },
    citations: [], finalInstruction: '',
  }
}

describe('PlatformRuleValidator', () => {
  it('flags output that violates a platform format rule', async () => {
    const v = new PlatformRuleValidator()
    const r = await v.validate({
      workspaceId: 'ws-a', platform: 'instagram',
      contextPack: pack(['avoid external links in the caption']),
      output: 'Read more via external links in the caption below.',
    })
    expect(r.passed).toBe(false)
    expect(r.issues[0]!.type).toBe('platform_violation')
    expect(r.severity).toBe('medium')
  })

  it('passes when no rule is violated', async () => {
    const v = new PlatformRuleValidator()
    const r = await v.validate({
      workspaceId: 'ws-a', platform: 'instagram',
      contextPack: pack(['avoid external links in the caption']),
      output: 'A clean caption with a strong hook.',
    })
    expect(r.passed).toBe(true)
  })
})
