import { describe, expect, it } from 'vitest'
import { DEFAULT_PROMPT_TEMPLATES, renderPrompt, buildBriefVars } from '../../src/content-pipeline/prompts.js'
import { buildBriefPrompt } from '../../src/content-pipeline/schemas.js'

describe('renderPrompt', () => {
  it('substitutes placeholders and leaves unknown ones empty', () => {
    expect(renderPrompt('A {{x}} B {{missing}} C', { x: 'X' })).toBe('A X B  C')
  })
})

describe('prompt builders with overrides', () => {
  const input = {
    rawIdea: { caption: 'CAP', assetRefs: [] },
    lessons: [{ type: 'tone_of_voice' as const, howToImprove: 'punchier' }],
  }

  it('uses the default template when no override is given', () => {
    const p = buildBriefPrompt(input)
    expect(p).toContain('IMPROVED BRIEF')
    expect(p).toContain('CAP')
    expect(p).toContain('punchier')
  })

  it('renders a custom template with the same step variables', () => {
    const p = buildBriefPrompt(input, 'ONLY THIS: {{source}}')
    expect(p).toContain('ONLY THIS:')
    expect(p).toContain('Caption: CAP')
    expect(p).not.toContain('IMPROVED BRIEF') // default text is gone
  })

  it('ships default templates for all three steps', () => {
    expect(DEFAULT_PROMPT_TEMPLATES.brief).toContain('{{source}}')
    expect(DEFAULT_PROMPT_TEMPLATES.refine).toContain('{{brief}}')
    expect(DEFAULT_PROMPT_TEMPLATES.ai_review).toContain('{{content}}')
  })
})

describe('buildBriefVars media block', () => {
  it('lists attached image paths for an image/carousel post', () => {
    const vars = buildBriefVars({
      rawIdea: { caption: 'c', assetRefs: [], mediaKind: 'carousel', localAssets: [
        { kind: 'image', fileName: '0.jpg', path: '/x/assets/0.jpg' },
        { kind: 'image', fileName: '1.jpg', path: '/x/assets/1.jpg' },
      ] },
      lessons: [],
    })
    expect(vars.media).toContain('assets/0.jpg')
    expect(vars.media).toContain('assets/1.jpg')
    expect(vars.media.toLowerCase()).toContain('image')
  })

  it('notes transcript-only analysis for a video post', () => {
    const vars = buildBriefVars({
      rawIdea: { caption: 'c', assetRefs: [], mediaKind: 'video', transcript: 'spoken', localAssets: [
        { kind: 'video', fileName: 'video.mp4', path: '/x/assets/video.mp4' },
      ] },
      lessons: [],
    })
    expect(vars.media.toLowerCase()).toContain('transcript')
    expect(vars.media).not.toContain('assets/video.mp4')
  })

  it('is empty when there are no local assets', () => {
    const vars = buildBriefVars({ rawIdea: { caption: 'c', assetRefs: [] }, lessons: [] })
    expect(vars.media).toBe('')
  })
})
