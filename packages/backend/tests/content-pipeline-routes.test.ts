import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'anubis-pipeline-routes-'))
  process.env.ANUBIS_DATA_DIR = tmpDir
})

afterAll(async () => {
  try {
    const services = await import('../src/services.js')
    await services.shutdownStack()
  } catch { /* best-effort */ }
  await rm(tmpDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
  delete process.env.ANUBIS_DATA_DIR
})

async function loadApp() {
  const mod = await import('../src/app.js')
  return mod.default
}

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

/** Seed a competitor + posts + a research session, returning a viral candidate id. */
async function seedCandidate(app: Awaited<ReturnType<typeof loadApp>>) {
  const comp = await app.request('/competitors', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle: '@pipeseed', projectId: 'default', followers: 25_000, favorite: true }),
  }).then((r) => r.json()) as { competitor: { id: string } }
  const competitorId = comp.competitor.id
  await app.request('/posts/import', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      posts: [
        { id: 'sp1', competitorId, username: 'pipeseed', postUrl: 'https://www.instagram.com/p/sp1/', likes: 50, postedAt: isoDaysAgo(1) },
        { id: 'sp2', competitorId, username: 'pipeseed', postUrl: 'https://www.instagram.com/p/sp2/', likes: 50, postedAt: isoDaysAgo(1) },
        { id: 'sp3', competitorId, username: 'pipeseed', postUrl: 'https://www.instagram.com/p/sp3/', likes: 50, postedAt: isoDaysAgo(1) },
        { id: 'sp4', competitorId, username: 'pipeseed', postUrl: 'https://www.instagram.com/p/sp4/', caption: 'viral hook', likes: 1000, postedAt: isoDaysAgo(1) },
      ],
    }),
  })
  const session = await app.request('/research/sessions', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: 'default', controls: { favoriteOnly: true } }),
  }).then((r) => r.json()) as { candidates: Array<{ id: string; postUrl?: string; likes: number }> }
  const viral = session.candidates.find((c) => c.likes === 1000)!
  return { candidateId: viral.id, postUrl: viral.postUrl }
}

describe('POST /content-items/from-candidate', () => {
  it('creates an idea carrying the candidate id and reference', async () => {
    const app = await loadApp()
    const { candidateId } = await seedCandidate(app)
    const res = await app.request('/content-items/from-candidate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ candidateId }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { item: { status: string; sourceCandidateId?: string; referencePostId?: string } }
    expect(body.item.status).toBe('idea')
    expect(body.item.sourceCandidateId).toBe(candidateId)
    expect(body.item.referencePostId).toBe('sp4')
  })

  it('404s for an unknown candidate', async () => {
    const app = await loadApp()
    const res = await app.request('/content-items/from-candidate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ candidateId: 'nope' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('pipeline routes', () => {
  it('GET /content-items/:id/pipeline returns the stored artifacts', async () => {
    const app = await loadApp()
    const { getStack } = await import('../src/services.js')
    const stack = getStack()
    stack.contentItems.create({ id: 'pc1', projectId: 'default', referenceUrl: 'https://x/p', title: 'T', status: 'raw_extracted', now: Date.now() })
    stack.contentPipeline.patch('pc1', { rawIdea: { caption: 'cap', assetRefs: [] } })
    const res = await app.request('/content-items/pc1/pipeline')
    expect(res.status).toBe(200)
    const body = await res.json() as { pipeline: { rawIdea?: { caption?: string } } }
    expect(body.pipeline.rawIdea?.caption).toBe('cap')
  })

  it('POST /content-items/:id/human-review rejects without a reason', async () => {
    const app = await loadApp()
    const { getStack } = await import('../src/services.js')
    getStack().contentItems.create({ id: 'pc2', projectId: 'default', referenceUrl: 'https://x/p2', title: 'T', status: 'human_review', now: Date.now() })
    const res = await app.request('/content-items/pc2/human-review', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'rejected' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /content-items/:id/human-review approves and enqueues generation', async () => {
    const app = await loadApp()
    const { getStack } = await import('../src/services.js')
    const stack = getStack()
    stack.contentItems.create({ id: 'pc3', projectId: 'default', referenceUrl: 'https://x/p3', title: 'T', status: 'human_review', now: Date.now() })
    stack.contentPipeline.patch('pc3', {
      refinedContent: {
        caption: 'c', visualBrief: { concept: '', sceneDirection: '', subject: '', layout: '', mood: '', style: '', keyElements: [] },
        copywriting: { hook: '', body: '', cta: '' }, hashtags: { primary: [], niche: [], brandSafe: [] },
      },
      rawIdea: { mediaKind: 'image', assetRefs: [] },
    })
    const res = await app.request('/content-items/pc3/human-review', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { review: { decision: string } }
    expect(body.review.decision).toBe('approved')
    expect(stack.contentItems.findById('pc3')?.status).toBe('generating')
    expect(stack.contentGenerationTasks.listByContent('pc3').length).toBeGreaterThan(0)
  })

  it('rejects an invalid pipeline step', async () => {
    const app = await loadApp()
    const res = await app.request('/content-items/pc3/pipeline/step/bogus', { method: 'POST' })
    expect(res.status).toBe(400)
  })
})

describe('lessons + brand context', () => {
  it('GET /lessons returns project lessons', async () => {
    const app = await loadApp()
    const { getStack } = await import('../src/services.js')
    getStack().contentLessons.create({ projectId: 'default', contentId: 'pc9', source: 'ai_review', type: 'tone_of_voice', reason: 'r', whatWentWrong: 'w', howToImprove: 'h' })
    const res = await app.request('/lessons?projectId=default')
    expect(res.status).toBe(200)
    const body = await res.json() as { lessons: unknown[] }
    expect(body.lessons.length).toBeGreaterThanOrEqual(1)
  })

  it('PUT then GET /brand-context round-trips', async () => {
    const app = await loadApp()
    const put = await app.request('/brand-context?projectId=default', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brandGuideline: 'BG', toneOfVoice: 'T', targetAudience: 'A', nichePositioning: 'N', contentRules: 'C' }),
    })
    expect(put.status).toBe(200)
    const get = await app.request('/brand-context?projectId=default').then((r) => r.json()) as { brandContext: { brandGuideline: string } }
    expect(get.brandContext.brandGuideline).toBe('BG')
  })
})

describe('generation routes', () => {
  it('GET /content-items/:id/generation returns tasks and draftOutput', async () => {
    const app = await loadApp()
    const { getStack } = await import('../src/services.js')
    const stack = getStack()
    stack.contentItems.create({ id: 'g1', projectId: 'default', referenceUrl: 'https://x/g1', title: 'T', status: 'generating', now: Date.now() })
    stack.contentGenerationTasks.create({ contentId: 'g1', projectId: 'default', type: 'image', capability: 'image', inputPrompt: 'p', status: 'pending' })
    const res = await app.request('/content-items/g1/generation')
    expect(res.status).toBe(200)
    const body = await res.json() as { tasks: unknown[]; draftOutput: unknown }
    expect(body.tasks).toHaveLength(1)
  })

  it('cancels a generation task', async () => {
    const app = await loadApp()
    const { getStack } = await import('../src/services.js')
    const stack = getStack()
    stack.contentItems.create({ id: 'g2', projectId: 'default', referenceUrl: 'https://x/g2', title: 'T', status: 'generating', now: Date.now() })
    const task = stack.contentGenerationTasks.create({ contentId: 'g2', projectId: 'default', type: 'image', capability: 'image', inputPrompt: 'p', status: 'pending' })
    const res = await app.request(`/content-items/g2/generation/tasks/${task.id}/cancel`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(stack.contentGenerationTasks.get(task.id)?.status).toBe('cancelled')
  })
})
