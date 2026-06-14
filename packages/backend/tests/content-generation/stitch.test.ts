import { describe, expect, it } from 'vitest'
import { stitchDraft } from '../../src/content-generation/stitch.js'
import type { ContentPipeline, GenerationTask } from '@anubis/shared'

const pipeline = {
  contentId: 'c1', autoIterationCount: 0, updatedAt: 1,
  refinedContent: {
    caption: 'refined cap', visualBrief: { concept: '', sceneDirection: '', subject: '', layout: '', mood: '', style: '', keyElements: [] },
    copywriting: { hook: 'h', body: 'b', cta: 'c' }, hashtags: { primary: ['#a'], niche: [], brandSafe: [] }, platformNotes: 'IG',
  },
  aiReview: { decision: 'approved', checklist: [] },
  humanReview: { decision: 'approved', reviewedAt: 9 },
} as unknown as ContentPipeline

const tasks: GenerationTask[] = [
  { id: 'tc', contentId: 'c1', projectId: 'default', type: 'final_caption', capability: 'text', generator: 'carry-forward-text', inputPrompt: 'final cap', status: 'completed', output: { text: 'final cap' }, retryCount: 0, createdAt: 1, updatedAt: 2 },
  { id: 'th', contentId: 'c1', projectId: 'default', type: 'final_hashtags', capability: 'text', generator: 'carry-forward-text', inputPrompt: '#a #b', status: 'completed', output: { text: '#a #b' }, retryCount: 0, createdAt: 1, updatedAt: 2 },
  { id: 'ti', contentId: 'c1', projectId: 'default', type: 'image', capability: 'image', generator: 'google-flow', inputPrompt: 'p', status: 'completed', output: { assetPaths: ['/a.png'] }, retryCount: 0, createdAt: 1, updatedAt: 2 },
]

describe('stitchDraft', () => {
  it('assembles caption, hashtags, assets, review history, logs', () => {
    const draft = stitchDraft({
      pipeline, tasks,
      sourceRef: { referenceUrl: 'https://x' },
      lessonsUsed: ['be punchier'],
      now: 100,
    })
    expect(draft.finalCaption).toBe('final cap')
    expect(draft.finalHashtags).toEqual(['#a', '#b'])
    expect(draft.assets[0]!.paths).toEqual(['/a.png'])
    expect(draft.reviewHistory.humanReview?.decision).toBe('approved')
    expect(draft.generationLogs).toHaveLength(3)
    expect(draft.stitchedAt).toBe(100)
  })

  it('falls back to refined caption/hashtags when text tasks are absent', () => {
    const draft = stitchDraft({ pipeline, tasks: [tasks[2]!], sourceRef: {}, lessonsUsed: [], now: 1 })
    expect(draft.finalCaption).toBe('refined cap')
    expect(draft.finalHashtags).toEqual(['#a'])
  })
})
