import { describe, expect, it } from 'vitest'
import { DEFAULT_PROMPT_TEMPLATES, renderPrompt } from '../../src/content-pipeline/prompts.js'
import { buildBriefPrompt } from '../../src/content-pipeline/schemas.js'

describe('renderPrompt', () => {
  it('substitutes placeholders and leaves unknown ones empty', () => {
    expect(renderPrompt('A {{x}} B {{missing}} C', { x: 'X' })).toBe('A X B  C')
  })
})

describe('prompt builders with overrides', () => {
  const input = {
    rawIdea: { caption: 'CAP', assetRefs: [] },
    context: 'Brand guideline: BE BOLD',
    lessons: [{ type: 'tone_of_voice' as const, howToImprove: 'punchier' }],
  }

  it('uses the default template when no override is given', () => {
    const p = buildBriefPrompt(input)
    expect(p).toContain('IMPROVED BRIEF')
    expect(p).toContain('CAP')
    expect(p).toContain('BE BOLD')
    expect(p).toContain('punchier')
  })

  it('renders a custom template with the same step variables', () => {
    const p = buildBriefPrompt(input, 'ONLY THIS: {{source}} || ctx={{context}}')
    expect(p).toContain('ONLY THIS:')
    expect(p).toContain('Caption: CAP')
    expect(p).toContain('ctx=Brand guideline: BE BOLD')
    expect(p).not.toContain('IMPROVED BRIEF') // default text is gone
  })

  it('falls back to a placeholder when no context is indexed', () => {
    const p = buildBriefPrompt({ ...input, context: '' })
    expect(p).toContain('(no project knowledge indexed for this item)')
  })

  it('ships default templates for all three steps', () => {
    expect(DEFAULT_PROMPT_TEMPLATES.brief).toContain('{{context}}')
    expect(DEFAULT_PROMPT_TEMPLATES.refine).toContain('{{brief}}')
    expect(DEFAULT_PROMPT_TEMPLATES.ai_review).toContain('{{content}}')
  })
})
