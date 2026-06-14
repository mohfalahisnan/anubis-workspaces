import { describe, expect, it } from 'vitest'
import {
  AiReviewSchema, ImprovedBriefSchema,
  buildBriefPrompt, buildReviewPrompt,
} from '../../src/content-pipeline/schemas.js'

describe('pipeline schemas', () => {
  it('validates a well-formed brief', () => {
    const ok = ImprovedBriefSchema.safeParse({
      coreIdea: 'a', targetAudience: 'b', marketFit: 'c', problem: 'd', mainMessage: 'e',
      contentAngle: 'f', hookDirection: 'g', brandAlignmentNotes: 'h', toneDirection: 'i',
      adaptationStrategy: 'j', riskNotes: 'k', referenceLessons: [],
    })
    expect(ok.success).toBe(true)
  })
  it('rejects an ai review with a bad decision', () => {
    const bad = AiReviewSchema.safeParse({ decision: 'maybe', checklist: [] })
    expect(bad.success).toBe(false)
  })
})

describe('prompt builders', () => {
  it('brief prompt embeds raw idea, brand context, and lessons', () => {
    const p = buildBriefPrompt({
      rawIdea: { caption: 'CAP', assetRefs: [] },
      brand: { brandGuideline: 'BG', toneOfVoice: 'TOV', targetAudience: 'TA', nichePositioning: 'NP', contentRules: 'CR' },
      lessons: [{ type: 'tone_of_voice', howToImprove: 'be punchier' }],
      kbHits: [],
    })
    expect(p).toContain('CAP')
    expect(p).toContain('BG')
    expect(p).toContain('be punchier')
    expect(p.toLowerCase()).toContain('json')
    expect(p).toContain('IMPROVED BRIEF')
  })
  it('review prompt asks for approved/rejected', () => {
    const p = buildReviewPrompt({ refined: { caption: 'x' } as never, brand: undefined, niche: 'NP' })
    expect(p).toContain('approved')
    expect(p).toContain('rejected')
  })
})
