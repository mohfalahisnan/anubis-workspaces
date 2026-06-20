import { describe, expect, it } from 'vitest'
import type { RefinedContent } from '@anubis/shared'
import { DEFAULT_GENERATION_TEMPLATES, renderImagePrompt, renderVideoPrompt } from '../../src/content-generation/generation-prompts.js'

const refined = (over: Partial<RefinedContent> = {}): RefinedContent => ({
  caption: 'Cap',
  visualBrief: { concept: 'C', sceneDirection: 'S', subject: 'Subj', layout: 'L', mood: 'M', style: 'St', keyElements: ['k1', 'k2'] },
  copywriting: { hook: 'h', body: 'b', cta: 'c' },
  hashtags: { primary: ['#a'], niche: [], brandSafe: [] },
  ...over,
})

describe('generation prompt rendering', () => {
  it('default image template includes subject, style, and joined key elements', () => {
    const out = renderImagePrompt(DEFAULT_GENERATION_TEMPLATES.image, refined().visualBrief)
    expect(out).toContain('Subj')
    expect(out).toContain('St')
    expect(out).toContain('k1, k2')
  })

  it('image template renders the slide placeholder for carousel', () => {
    const out = renderImagePrompt('Slide: {{slide}}', refined().visualBrief, 'slide one')
    expect(out).toBe('Slide: slide one')
  })

  it('custom image template renders only requested placeholders', () => {
    expect(renderImagePrompt('Make {{subject}} in {{style}}', refined().visualBrief)).toBe('Make Subj in St')
  })

  it('video template renders videoScript, falling back to concept', () => {
    const withScript = refined({ copywriting: { hook: 'h', body: 'b', cta: 'c', videoScript: 'read this' } })
    expect(renderVideoPrompt(DEFAULT_GENERATION_TEMPLATES.video, withScript)).toBe('read this')
    expect(renderVideoPrompt(DEFAULT_GENERATION_TEMPLATES.video, refined())).toBe('C') // falls back to concept
  })
})
