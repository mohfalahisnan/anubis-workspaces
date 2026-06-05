import { describe, it, expect } from 'vitest'
import { BrandRuleValidator } from '../../src/validators/brand-rule-validator.js'
import type { ContentContextPack } from '../../src/context-pack/types.js'

function pack(over: Partial<ContentContextPack['brandContext'] & ContentContextPack['workspaceRules']>): ContentContextPack {
  return {
    workspaceId: 'ws-a', platform: 'instagram', taskType: 'generate_content', objective: 'o',
    brandContext: { brandSummary: '', toneOfVoice: [], audience: [], offers: [],
      constraints: over.constraints ?? [] },
    platformContext: { platform: 'instagram', formatRules: [], contentPatterns: [], algorithmNotes: [] },
    similarContent: { approved: [], competitor: [], rejected: [] },
    globalFrameworks: { hooks: [], copywritingPatterns: [], contentStructures: [], ctaPatterns: [] },
    workspaceRules: { mustFollow: over.mustFollow ?? [], mustAvoid: over.mustAvoid ?? [], clientPreferences: [] },
    experienceMemory: { previousMistakes: [], reviewerFeedback: [], validationRules: [] },
    citations: [], finalInstruction: '',
  }
}

describe('BrandRuleValidator', () => {
  it('flags output that violates a brand constraint', async () => {
    const v = new BrandRuleValidator()
    const r = await v.validate({
      workspaceId: 'ws-a', platform: 'instagram',
      contextPack: pack({ constraints: ['avoid fear-based hooks'] }),
      output: 'Use fear-based hooks to grab attention.',
    })
    expect(r.passed).toBe(false)
    expect(r.issues[0]!.type).toBe('brand_violation')
    expect(r.severity).toBe('high')
  })

  it('passes compliant output', async () => {
    const v = new BrandRuleValidator()
    const r = await v.validate({
      workspaceId: 'ws-a', platform: 'instagram',
      contextPack: pack({ constraints: ['avoid fear-based hooks'] }),
      output: 'A calm, educational opener.',
    })
    expect(r.passed).toBe(true)
  })
})
