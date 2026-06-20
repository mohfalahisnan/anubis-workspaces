import { describe, expect, it, vi } from 'vitest'
import { GenerationService } from '../../src/content-generation/generation-service.js'
import type { GenerationTask } from '@anubis/shared'

function refinedFixture() {
  return {
    caption: 'cap', visualBrief: { concept: 'c', sceneDirection: '', subject: 's', layout: '', mood: '', style: '', keyElements: [] },
    copywriting: { hook: 'h', body: 'b', cta: 'c' }, hashtags: { primary: ['#a'], niche: [], brandSafe: [] },
  }
}

function makeDeps(over: Record<string, unknown> = {}) {
  const item = { id: 'c1', projectId: 'default', status: 'generating' }
  let pipeline: Record<string, unknown> = { contentId: 'c1', autoIterationCount: 0, refinedContent: refinedFixture(), rawIdea: { mediaKind: 'image', assetRefs: [] } }
  let tasks: GenerationTask[] = []
  const lessons: Array<Record<string, unknown>> = []
  const statuses: string[] = []
  let seq = 0
  const tasksRepo = {
    create: vi.fn((t: Record<string, unknown>) => { const x = { id: `t${++seq}`, generator: '', retryCount: 0, createdAt: seq, updatedAt: seq, ...t } as unknown as GenerationTask; tasks.push(x); return x }),
    get: vi.fn((id: string) => tasks.find((t) => t.id === id) ?? null),
    listByContent: vi.fn(() => tasks),
    update: vi.fn((id: string, patch: Record<string, unknown>) => { const i = tasks.findIndex((t) => t.id === id); tasks[i] = { ...tasks[i]!, ...patch } as GenerationTask; return tasks[i]! }),
    deleteByContent: vi.fn(() => { tasks = [] }),
  }
  return {
    tasks: () => tasks, lessons, statuses,
    deps: {
      getItem: vi.fn(() => ({ ...item })),
      setStatus: vi.fn((_id: string, s: string) => { item.status = s; statuses.push(s) }),
      pipeline: {
        get: vi.fn(() => pipeline),
        patch: vi.fn((_id: string, patch: Record<string, unknown>) => { pipeline = { ...pipeline, ...patch }; return pipeline }),
      },
      taskRepo: tasksRepo,
      lessons: { create: vi.fn((l: Record<string, unknown>) => { lessons.push(l); return { id: 'L', createdAt: 1, ...l } }) },
      registry: { get: vi.fn(() => ({ name: 'mock', capability: 'text', generate: vi.fn(async () => ({ text: 'ok' })) })) },
      genDirsFor: vi.fn(() => ({ workspaceDir: '/tmp/ws', assetDir: '/tmp/ws/outputs/generated-assets/c1' })),
      maxRetries: 2,
      getGenerationProfiles: vi.fn(() => ({})),
      ...over,
    },
  }
}

describe('GenerationService.enqueue', () => {
  it('derives and inserts tasks (replacing prior ones)', () => {
    const { deps, tasks } = makeDeps()
    new GenerationService(deps as never).enqueue('c1')
    expect(deps.taskRepo.deleteByContent).toHaveBeenCalledWith('c1')
    expect(tasks().map((t) => t.type)).toEqual(['final_caption', 'final_hashtags', 'image'])
  })
})

describe('GenerationService.runAll', () => {
  it('runs pending tasks, stitches draft, sets status draft', async () => {
    const { deps, statuses } = makeDeps({ getGenerationProfiles: vi.fn(() => ({ image: 'codex-image' })) })
    const svc = new GenerationService(deps as never)
    svc.enqueue('c1')
    deps.registry.get.mockReturnValue({ name: 'mock', capability: 'image', generate: vi.fn(async () => ({ assetPaths: ['/a.png'] })) })
    await svc.runAll('c1')
    expect(statuses).toContain('draft')
    expect(deps.pipeline.patch).toHaveBeenCalledWith('c1', expect.objectContaining({ draftOutput: expect.any(Object) }))
  })

  it('passes conversationId + onConversation to the generator and persists the id', async () => {
    const { deps, tasks } = makeDeps({ getGenerationProfiles: vi.fn(() => ({ image: 'codex-image' })) })
    const svc = new GenerationService(deps as never)
    svc.enqueue('c1')
    deps.registry.get.mockReturnValue({
      name: 'mock', capability: 'image',
      generate: vi.fn(async (_task, ctx: { conversationId?: string; onConversation?: (id: string) => void }) => {
        expect(ctx.conversationId).toBeUndefined()
        ctx.onConversation?.('conv-x')
        return { assetPaths: ['/a.png'] }
      }),
    })
    await svc.runAll('c1')
    const imageTask = tasks().find((t) => t.capability === 'image')!
    expect(imageTask.conversationId).toBe('conv-x')
  })

  it('creates a generation_failure lesson and stays generating when a task fails', async () => {
    const { deps, lessons, statuses } = makeDeps({ getGenerationProfiles: vi.fn(() => ({ image: 'codex-image' })) })
    const svc = new GenerationService(deps as never)
    svc.enqueue('c1')
    deps.registry.get.mockReturnValue({ name: 'mock', capability: 'image', generate: vi.fn(async () => { throw new Error('boom') }) })
    await svc.runAll('c1')
    expect(lessons.some((l) => l.source === 'generation_failure')).toBe(true)
    expect(statuses).not.toContain('draft')
  })
})

describe('GenerationService.enqueue with generation profiles', () => {
  it('defaults image to manual when no profiles are configured', async () => {
    const { deps, tasks, statuses } = makeDeps()
    const svc = new GenerationService(deps as never)
    svc.enqueue('c1')
    expect(tasks().find((t) => t.type === 'image')!.status).toBe('manual')
    await svc.runAll('c1')
    expect(statuses).toContain('draft')
    expect(tasks().find((t) => t.type === 'image')!.status).toBe('manual')
  })

  it('a project override re-enables auto image generation (pending)', () => {
    const { deps, tasks } = makeDeps({ getGenerationProfiles: vi.fn(() => ({ image: 'codex-image' })) })
    new GenerationService(deps as never).enqueue('c1')
    expect(tasks().find((t) => t.type === 'image')!.status).toBe('pending')
  })
})
