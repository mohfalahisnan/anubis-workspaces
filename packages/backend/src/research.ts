import { Hono } from 'hono'
import { z } from 'zod'
import { getStack } from './services.js'

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
