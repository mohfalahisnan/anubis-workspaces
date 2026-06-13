import { Hono } from 'hono'
import { z } from 'zod'
import { getStack } from './services.js'
import { newId } from '@anubis/conversation'

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

const ResearchDocumentStatus = z.enum(['draft', 'final', 'archived'])
const ResearchDocumentBody = z.object({
  projectId: z.string().min(1).optional(),
  title: z.string().min(1),
  status: ResearchDocumentStatus.optional(),
  tags: z.array(z.string()).optional(),
  candidateIds: z.array(z.string()).optional(),
  competitorIds: z.array(z.string()).optional(),
  postIds: z.array(z.string()).optional(),
  sourceUrls: z.array(z.string()).optional(),
  summary: z.string().optional(),
  findings: z.string().optional(),
  evidence: z.string().optional(),
}).strict()

const ResearchDocumentPatch = ResearchDocumentBody.partial().omit({ projectId: true })
const PromoteCandidateBody = z.object({ title: z.string().min(1).optional() }).strict()

export const researchRoutes = new Hono()

researchRoutes.post('/documents', async (c) => {
  const body = ResearchDocumentBody.parse(await c.req.json())
  const now = Date.now()
  const document = getStack().researchDocuments.create({
    id: newId(),
    ...body,
    title: body.title.trim(),
    now,
  })
  return c.json({ ok: true, document }, 201)
})

researchRoutes.get('/documents', (c) => {
  return c.json({ ok: true, items: getStack().researchDocuments.list(c.req.query('projectId')) })
})

researchRoutes.get('/documents/:id', (c) => {
  const document = getStack().researchDocuments.findById(c.req.param('id'))
  if (!document) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, document })
})

researchRoutes.patch('/documents/:id', async (c) => {
  const body = ResearchDocumentPatch.parse(await c.req.json())
  const document = getStack().researchDocuments.update(c.req.param('id'), body)
  if (!document) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, document })
})

researchRoutes.delete('/documents/:id', (c) => {
  const document = getStack().researchDocuments.delete(c.req.param('id'))
  if (!document) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true })
})

researchRoutes.post('/candidates/:id/promote', async (c) => {
  const body = PromoteCandidateBody.parse(await c.req.json().catch(() => ({})))
  const stack = getStack()
  const candidate = stack.research.getCandidate(c.req.param('id'))
  if (!candidate) return c.json({ ok: false, error: 'not_found' }, 404)
  const competitor = stack.competitors.get(candidate.competitorId)
  const document = stack.researchDocuments.create({
    id: newId(),
    projectId: candidate.projectId ?? 'default',
    title: body.title?.trim() || `Research: ${competitor?.handle ?? candidate.postId}`,
    status: 'draft',
    candidateIds: [candidate.id],
    competitorIds: [candidate.competitorId],
    postIds: [candidate.postId],
    sourceUrls: candidate.postUrl ? [candidate.postUrl] : [],
    summary: candidate.caption,
    evidence: candidate.postUrl,
    now: Date.now(),
  })
  return c.json({ ok: true, document }, 201)
})

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
