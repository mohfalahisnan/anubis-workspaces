import { Hono } from 'hono'
import { z } from 'zod'
import { getStack } from './services.js'

const captureProfileSchema = z.enum(['public', 'login'])
const actionTypeSchema = z.enum(['message', 'competitor-discovery', 'capture-posts', 'workflow'])
const actionConfigSchema = z.union([
  z.object({
    projectId: z.string().min(1),
    query: z.string().min(1),
    captureProfile: captureProfileSchema,
    defaultLevel: z.enum(['black', 'green', 'yellow', 'red']).optional(),
  }).strict(),
  z.object({
    projectId: z.string().min(1),
    handles: z.union([z.literal('all'), z.array(z.string().min(1))]),
    captureProfile: captureProfileSchema,
    postLimit: z.number().int().positive().optional(),
  }).strict(),
  z.object({
    workflowId: z.string().min(1).optional(),
    workflowName: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    input: z.record(z.string(), z.unknown()).optional(),
  }).strict().refine(
    (v) => Boolean(v.workflowId) || Boolean(v.workflowName),
    { message: 'workflow config requires workflowId or workflowName' },
  ),
])

const CreateBody = z.object({
  name: z.string().min(1),
  schedule: z.string().min(1),
  scheduleDescription: z.string().optional(),
  actionType: actionTypeSchema,
  actionConfig: actionConfigSchema.optional(),
  prompt: z.string().optional(),
  projectId: z.string().optional(),
}).strict()

const UpdateBody = z.object({
  name: z.string().min(1).optional(),
  schedule: z.string().min(1).optional(),
  scheduleDescription: z.string().optional(),
  actionType: actionTypeSchema.optional(),
  actionConfig: actionConfigSchema.optional(),
  prompt: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
}).strict()

export const cronRoutes = new Hono()

cronRoutes.get('/', (c) => {
  const conv = c.req.query('conversationId') || undefined
  const projectId = c.req.query('projectId') || undefined
  return c.json({ ok: true, items: getStack().cron.list(conv, projectId) })
})

cronRoutes.post('/', async (c) => {
  const body = CreateBody.parse(await c.req.json())
  const stack = getStack()
  const projectId = body.projectId || 'default'

  // Ensure a conversation exists for the project
  const convs = stack.conversation.list({ projectId, limit: 1 })
  let conversationId: string
  if (convs.length > 0) {
    conversationId = convs[0].id
  } else {
    const newConv = stack.conversation.create({
      title: 'Cron Workspace',
      projectId,
    })
    conversationId = newConv.id
  }

  // Use cron.handle to create and schedule the job
  stack.cron.handle({
    kind: 'create',
    params: {
      name: body.name,
      schedule: body.schedule,
      scheduleDescription: body.scheduleDescription,
      actionType: body.actionType,
      actionConfig: body.actionConfig,
      message: body.prompt,
    }
  }, conversationId)

  // Retrieve the newly created job
  const items = stack.cron.list(conversationId)
  const job = items[0]

  return c.json({ ok: true, job }, 201)
})

cronRoutes.patch('/:id', async (c) => {
  const body = UpdateBody.parse(await c.req.json())
  const job = getStack().cron.update(c.req.param('id'), body)
  if (!job) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, job })
})

cronRoutes.delete('/:id', (c) => {
  getStack().cron.delete(c.req.param('id'))
  return c.json({ ok: true })
})
