import { describe, expect, it } from 'vitest'
import { deriveTasks, buildImagePrompt } from '../../src/content-generation/derive-tasks.js'
import type { RefinedContent } from '@anubis/shared'

function refined(over: Partial<RefinedContent> = {}): RefinedContent {
  return {
    caption: 'Cap', visualBrief: { concept: 'C', sceneDirection: 'S', subject: 'Subj', layout: 'L', mood: 'M', style: 'St', keyElements: ['k1'] },
    copywriting: { hook: 'h', body: 'b', cta: 'c' },
    hashtags: { primary: ['#a'], niche: ['#b'], brandSafe: ['#c'] },
    ...over,
  }
}

describe('deriveTasks', () => {
  it('image post → caption, hashtags, single image (no overlay, no manual)', () => {
    const tasks = deriveTasks(refined(), 'image')
    expect(tasks.map((t) => t.type)).toEqual(['final_caption', 'final_hashtags', 'image'])
    expect(tasks.every((t) => t.status === 'pending')).toBe(true)
  })

  it('carousel with 3 slides → 3 carousel tasks', () => {
    const r = refined({ copywriting: { hook: 'h', body: 'b', cta: 'c', carouselSlides: ['s1', 's2', 's3'] } })
    const tasks = deriveTasks(r, 'carousel')
    expect(tasks.filter((t) => t.type === 'carousel')).toHaveLength(3)
  })

  it('adds a text_overlay task when overlay text is present', () => {
    const r = refined({ visualBrief: { ...refined().visualBrief, textOverlay: 'BUY NOW' } })
    const tasks = deriveTasks(r, 'image')
    expect(tasks.some((t) => t.type === 'text_overlay' && t.inputPrompt === 'BUY NOW')).toBe(true)
  })

  it('video source → manual video task; videoScript → manual voiceover task', () => {
    const r = refined({ copywriting: { hook: 'h', body: 'b', cta: 'c', videoScript: 'read this' } })
    const tasks = deriveTasks(r, 'video')
    expect(tasks.find((t) => t.type === 'video')?.status).toBe('manual')
    expect(tasks.find((t) => t.type === 'voiceover')?.status).toBe('manual')
  })

  it('buildImagePrompt composes the visual brief', () => {
    const p = buildImagePrompt(refined().visualBrief, 'extra slide copy')
    expect(p).toContain('Subj')
    expect(p).toContain('extra slide copy')
  })
})
