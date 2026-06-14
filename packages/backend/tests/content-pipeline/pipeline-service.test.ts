import { describe, expect, it, vi } from 'vitest'
import { ContentPipelineService } from '../../src/content-pipeline/pipeline-service.js'

function briefFixture() {
  return { coreIdea: 'a', targetAudience: 'b', marketFit: 'c', problem: 'd', mainMessage: 'e', contentAngle: 'f', hookDirection: 'g', brandAlignmentNotes: 'h', toneDirection: 'i', adaptationStrategy: 'j', riskNotes: 'k', referenceLessons: [] }
}
function refinedFixture() {
  return { caption: 'x', visualBrief: { concept: '', sceneDirection: '', subject: '', layout: '', mood: '', style: '', keyElements: [] }, copywriting: { hook: '', body: '', cta: '' }, hashtags: { primary: [], niche: [], brandSafe: [] } }
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const statuses: string[] = []
  const item = { id: 'c1', projectId: 'default', status: 'raw_extracted', referencePostId: undefined, referenceUrl: 'u' }
  let pipeline: Record<string, unknown> = { contentId: 'c1', autoIterationCount: 0, rawIdea: { caption: 'cap', assetRefs: [] } }
  const lessons: Array<Record<string, unknown>> = []
  return {
    statuses, lessons,
    deps: {
      getItem: vi.fn(() => ({ ...item })),
      setStatus: vi.fn((_id: string, s: string) => { item.status = s; statuses.push(s) }),
      pipeline: {
        get: vi.fn(() => pipeline),
        patch: vi.fn((_id: string, patch: Record<string, unknown>) => { pipeline = { ...pipeline, ...patch }; return pipeline }),
        incrementIteration: vi.fn(() => (pipeline.autoIterationCount = (pipeline.autoIterationCount as number) + 1)),
        resetIteration: vi.fn(() => { pipeline.autoIterationCount = 0 }),
      },
      history: { append: vi.fn() },
      lessons: {
        create: vi.fn((l: Record<string, unknown>) => { const x = { id: 'L', createdAt: 1, ...l }; lessons.push(x); return x }),
        listForInjection: vi.fn(() => []),
      },
      brand: { get: vi.fn(() => undefined) },
      kbSearch: vi.fn(async () => []),
      runAgent: vi.fn(),
      extract: vi.fn(async () => ({ caption: 'cap', assetRefs: [] })),
      appConfig: { get: vi.fn(() => ({})) },
      maxAutoIterations: 3,
      ...overrides,
    },
  }
}

describe('ContentPipelineService.runBreakdown', () => {
  it('produces a brief and moves to status brief', async () => {
    const { deps } = makeDeps()
    deps.runAgent.mockResolvedValue(JSON.stringify(briefFixture()))
    const svc = new ContentPipelineService(deps as never)
    await svc.runBreakdown('c1')
    expect(deps.pipeline.patch).toHaveBeenCalledWith('c1', expect.objectContaining({ improvedBrief: expect.any(Object) }))
    expect(deps.setStatus).toHaveBeenCalledWith('c1', 'brief')
  })

  it('records a history snapshot for the produced brief', async () => {
    const { deps } = makeDeps()
    deps.runAgent.mockResolvedValue(JSON.stringify(briefFixture()))
    const svc = new ContentPipelineService(deps as never)
    await svc.runBreakdown('c1')
    expect(deps.history.append).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: 'c1', step: 'breakdown', iteration: 0, data: expect.any(Object) }),
    )
  })
})

describe('ContentPipelineService.runAiReview', () => {
  it('approved → status human_review, no lesson', async () => {
    const { deps, lessons } = makeDeps()
    deps.pipeline.get.mockReturnValue({ contentId: 'c1', autoIterationCount: 0, refinedContent: { caption: 'x' } })
    deps.runAgent.mockResolvedValue(JSON.stringify({ decision: 'approved', checklist: [] }))
    const svc = new ContentPipelineService(deps as never)
    const r = await svc.runAiReview('c1')
    expect(r.decision).toBe('approved')
    expect(deps.setStatus).toHaveBeenCalledWith('c1', 'human_review')
    expect(lessons).toHaveLength(0)
  })

  it('rejected → creates a lesson and moves back to brief', async () => {
    const { deps, lessons } = makeDeps()
    deps.pipeline.get.mockReturnValue({ contentId: 'c1', autoIterationCount: 0, refinedContent: { caption: 'x' } })
    deps.runAgent.mockResolvedValue(JSON.stringify({
      decision: 'rejected', checklist: [], rejectionReason: 'off-brand', improvementInstruction: 'fix tone',
    }))
    const svc = new ContentPipelineService(deps as never)
    const r = await svc.runAiReview('c1')
    expect(r.decision).toBe('rejected')
    expect(lessons[0]!.source).toBe('ai_review')
    expect(deps.setStatus).toHaveBeenCalledWith('c1', 'brief')
  })
})

describe('ContentPipelineService.submitHumanReview', () => {
  it('reject requires a reason and creates a human lesson', async () => {
    const { deps, lessons } = makeDeps()
    const svc = new ContentPipelineService(deps as never)
    await expect(svc.submitHumanReview('c1', { decision: 'rejected' })).rejects.toThrow()
    await svc.submitHumanReview('c1', { decision: 'rejected', reason: 'weak hook', type: 'copywriting_quality' })
    expect(lessons[0]!.source).toBe('human_review')
    expect(deps.setStatus).toHaveBeenCalledWith('c1', 'brief')
  })

  it('approve advances status to generating', async () => {
    const { deps } = makeDeps()
    const svc = new ContentPipelineService(deps as never)
    await svc.submitHumanReview('c1', { decision: 'approved' })
    expect(deps.setStatus).toHaveBeenCalledWith('c1', 'generating')
  })
})

describe('ContentPipelineService.runAuto loop guard', () => {
  it('stops after maxAutoIterations consecutive rejections', async () => {
    const { deps } = makeDeps({ maxAutoIterations: 2 })
    deps.pipeline.get.mockReturnValue({ contentId: 'c1', autoIterationCount: 0, rawIdea: { caption: 'c', assetRefs: [] }, improvedBrief: briefFixture(), refinedContent: refinedFixture() })
    deps.runAgent.mockImplementation(async (input: { prompt: string }) => {
      if (input.prompt.includes('IMPROVED BRIEF')) return JSON.stringify(briefFixture())
      if (input.prompt.includes('content-ready')) return JSON.stringify(refinedFixture())
      return JSON.stringify({ decision: 'rejected', checklist: [], rejectionReason: 'no', improvementInstruction: 'x' })
    })
    const svc = new ContentPipelineService(deps as never)
    const result = await svc.runAuto('c1')
    expect(result.stoppedReason).toBe('max_iterations')
  })
})
