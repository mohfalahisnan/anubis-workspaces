import { Hono } from 'hono'
import { z } from 'zod'
import { getStack } from './services.js'
import { brandWorkspaceRoutes } from './brand-workspaces.js'

const PLATFORM = z.enum([
  'instagram', 'tiktok', 'youtube', 'facebook', 'linkedin', 'x', 'threads', 'general',
])
const TASK_TYPE = z.enum([
  'analyze_competitor', 'build_brief', 'generate_content',
  'rewrite_content', 'review_content', 'create_calendar',
])

const BuildBody = z.object({
  workspaceId: z.string().min(1),
  platform: PLATFORM,
  taskType: TASK_TYPE,
  query: z.string().min(1),
  objective: z.string().min(1),
  campaignId: z.string().min(1).optional(),
  limitPerBucket: z.number().int().positive().max(20).optional(),
}).strict()

export const contentMemoryRoutes = new Hono()

contentMemoryRoutes.route('/workspaces', brandWorkspaceRoutes)

contentMemoryRoutes.post('/context-pack', async (c) => {
  const body = BuildBody.parse(await c.req.json())
  const { pack, packId } = await getStack().contentMemory.buildForContentTask(body)
  return c.json({ ok: true, packId, pack })
})

const SEVERITY = z.enum(['low', 'medium', 'high', 'critical'])
const MEMORY_TYPE = z.enum([
  'mistake', 'correction', 'workflow_rule', 'validation_rule',
  'preference', 'anti_pattern', 'lesson',
])

const FeedbackBody = z.object({
  runId: z.string().min(1),
  workspaceId: z.string().min(1),
  platform: PLATFORM.optional(),
  rating: z.enum(['good', 'bad', 'partial']),
  feedback: z.string().min(1),
  createExperienceMemory: z.boolean().optional(),
  memoryType: MEMORY_TYPE.optional(),
  severity: SEVERITY.optional(),
}).strict()

contentMemoryRoutes.post('/feedback', async (c) => {
  const body = FeedbackBody.parse(await c.req.json())
  const memory = getStack().experience.saveFeedback(body)
  return c.json({ ok: true, memory })
})

contentMemoryRoutes.post('/memories/:id/promote', (c) => {
  getStack().experience.promote(c.req.param('id'))
  return c.json({ ok: true })
})

const VALIDATION_STATUS = z.enum(['passed', 'failed', 'needs_review'])

const ValidateBody = z.object({
  workspaceId: z.string().min(1),
  platform: PLATFORM,
  packId: z.string().min(1),
  output: z.string().min(1),
}).strict()

contentMemoryRoutes.post('/validate', async (c) => {
  const body = ValidateBody.parse(await c.req.json())
  const pack = getStack().contentMemory.getPack(body.packId)
  if (!pack) return c.json({ ok: false, error: 'pack_not_found' }, 404)
  const result = await getStack().validation.validate({
    workspaceId: body.workspaceId, platform: body.platform, contextPack: pack, output: body.output,
  })
  return c.json({ ok: true, result })
})

const RunBody = z.object({
  workspaceId: z.string().min(1),
  platform: PLATFORM.optional(),
  campaignId: z.string().min(1).optional(),
  agentId: z.string().min(1),
  workflowId: z.string().min(1).optional(),
  taskType: TASK_TYPE,
  userInput: z.string().min(1),
  intent: z.string().min(1),
  contextPackId: z.string().min(1).optional(),
  plan: z.string().optional(),
  output: z.string(),
  retrievedChunkIds: z.array(z.string()).optional(),
  retrievedDecisionIds: z.array(z.string()).optional(),
  retrievedExperienceMemoryIds: z.array(z.string()).optional(),
  retrievedSimilarityItemIds: z.array(z.string()).optional(),
  validationStatus: VALIDATION_STATUS,
  humanFeedback: z.string().optional(),
  errorType: z.string().optional(),
  errorSummary: z.string().optional(),
}).strict()

contentMemoryRoutes.post('/runs', async (c) => {
  const body = RunBody.parse(await c.req.json())
  const run = getStack().agentRuns.saveRun(body)
  return c.json({ ok: true, run }, 201)
})
