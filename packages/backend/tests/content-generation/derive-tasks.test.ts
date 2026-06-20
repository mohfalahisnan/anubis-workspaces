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

  it('video source → pending video task; videoScript → manual voiceover task', () => {
    const r = refined({ copywriting: { hook: 'h', body: 'b', cta: 'c', videoScript: 'read this' } })
    const tasks = deriveTasks(r, 'video')
    expect(tasks.find((t) => t.type === 'video')?.status).toBe('pending')
    expect(tasks.find((t) => t.type === 'voiceover')?.status).toBe('manual')
  })

  it('manual.image → image task is manual (prompt-only)', () => {
    const tasks = deriveTasks(refined(), 'image', { image: true })
    expect(tasks.find((t) => t.type === 'image')?.status).toBe('manual')
  })

  it('manual.image → every carousel task is manual', () => {
    const r = refined({ copywriting: { hook: 'h', body: 'b', cta: 'c', carouselSlides: ['s1', 's2'] } })
    const tasks = deriveTasks(r, 'carousel', { image: true })
    const carousel = tasks.filter((t) => t.type === 'carousel')
    expect(carousel).toHaveLength(2)
    expect(carousel.every((t) => t.status === 'manual')).toBe(true)
  })

  it('manual.video → video task is manual; text tasks stay pending', () => {
    const r = refined({ copywriting: { hook: 'h', body: 'b', cta: 'c', videoScript: 'read this' } })
    const tasks = deriveTasks(r, 'video', { video: true })
    expect(tasks.find((t) => t.type === 'video')?.status).toBe('manual')
    expect(tasks.find((t) => t.type === 'final_caption')?.status).toBe('pending')
  })

  it('no manual arg → media stays pending (unchanged default)', () => {
    const tasks = deriveTasks(refined(), 'image')
    expect(tasks.find((t) => t.type === 'image')?.status).toBe('pending')
  })

  it('buildImagePrompt composes the visual brief', () => {
    const p = buildImagePrompt(refined().visualBrief, 'extra slide copy')
    expect(p).toContain('Subj')
    expect(p).toContain('extra slide copy')
  })
})
