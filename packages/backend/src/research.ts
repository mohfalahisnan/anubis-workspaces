import { Hono } from 'hono'
import { z } from 'zod'
import { getStack } from './services.js'
import { validateSessionNiche, type NicheItem } from './research-niche.js'

const ControlsSchema = z.object({
  competitorIds: z.array(z.string().min(1)).optional(),
  favoriteOnly: z.boolean().optional(),
  platform: z.string().min(1).optional(),
  niche: z.string().min(1).optional(),
  dateFrom: z.string().min(1).optional(),
  dateTo: z.string().min(1).optional(),
  maxPostsPerProfile: z.number().int().positive().max(200).optional(),
  maxContentAgeDays: z.number().int().positive().max(365).optional(),
}).strict()

const CreateSessionBody = z.object({
  projectId: z.string().min(1).optional(),
  controls: ControlsSchema.optional(),
}).strict()

const UpdateCandidateBody = z.object({
  decision: z.enum(['none', 'selected', 'rejected', 'saved']).optional(),
  nicheAligned: z.boolean().nullable().optional(),
  nicheReason: z.string().nullable().optional(),
}).strict()

export const researchRoutes = new Hono()

// Static segments before parameterised ones (Hono resolves by registration order).
researchRoutes.post('/sessions', async (c) => {
  const body = CreateSessionBody.parse(await c.req.json())
  const { session, candidates } = await getStack().research.createSession(body)
  return c.json({ ok: true, session, candidates }, 201)
})

researchRoutes.post('/sessions/:id/validate-niche', async (c) => {
  const sessionId = c.req.param('id')
  const stack = getStack()
  const session = stack.research.getSession(sessionId)
  if (!session) return c.json({ ok: false, error: 'not_found' }, 404)

  const projectId = session.projectId ?? 'default'
  const project = stack.projects.findById(projectId)
  if (!project?.workdir) {
    return c.json(
      { ok: false, error: 'no_workdir', message: 'This project has no workspace directory; set one to use AI niche validation.' },
      400,
    )
  }

  const pending = stack.research
    .listCandidates({ sessionId })
    .filter((x) => x.validationStatus === 'pending')
  if (pending.length === 0) {
    return c.json({ ok: true, updated: 0, candidates: [] })
  }

  const items: NicheItem[] = pending.map((cand) => {
    const competitor = stack.competitors.get(cand.competitorId)
    return {
      id: cand.id,
      caption: cand.caption ?? '',
      competitorHandle: competitor?.handle ?? cand.competitorId,
      competitorNiche: competitor?.niche,
    }
  })

  // Best-effort niche context from the workspace knowledge base.
  let nicheContext: string | undefined
  try {
    const { contextPack } = await import('./knowledge-base.js')
    const res = await contextPack({ projectId, query: 'our niche, brand, target audience, content positioning', budget: 1500 })
    nicheContext = res.text?.trim() || undefined
  } catch {
    nicheContext = undefined
  }

  const workdir = project.workdir
  const ask = (prompt: string) =>
    stack.aiAgent
      .runAgent({
        agent: 'claude',
        cwd: workdir,
        prompt,
        appendSystemPrompt: 'You output ONLY valid JSON (a single array). No markdown fences, no prose.',
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
      })
      .then((r) => r.text)

  let verdicts
  try {
    verdicts = await validateSessionNiche({ items, nicheContext, ask })
  } catch (e) {
    return c.json({ ok: false, error: 'agent_failed', message: e instanceof Error ? e.message : 'Niche validation failed.' }, 502)
  }

  const updated = []
  for (const v of verdicts) {
    const u = stack.research.updateCandidate(v.id, { nicheAligned: v.aligned, nicheReason: v.reason })
    if (u) updated.push(u)
  }
  return c.json({ ok: true, updated: updated.length, candidates: updated })
})

researchRoutes.get('/sessions', (c) => {
  const projectId = c.req.query('projectId')
  return c.json({ ok: true, items: getStack().research.listSessions(projectId) })
})

researchRoutes.get('/sessions/:id/candidates', (c) => {
  const items = getStack().research.listCandidates({ sessionId: c.req.param('id') })
  return c.json({ ok: true, items })
})

researchRoutes.get('/sessions/:id', (c) => {
  const session = getStack().research.getSession(c.req.param('id'))
  if (!session) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, session })
})

researchRoutes.get('/candidates', (c) => {
  const items = getStack().research.listCandidates({
    projectId: c.req.query('projectId'),
    validationStatus: c.req.query('validation') as never,
    candidateLevel: c.req.query('level') as never,
    decision: c.req.query('decision') as never,
  })
  return c.json({ ok: true, items })
})

researchRoutes.patch('/candidates/:id', async (c) => {
  const body = UpdateCandidateBody.parse(await c.req.json())
  const updated = getStack().research.updateCandidate(c.req.param('id'), body)
  if (!updated) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, candidate: updated })
})
