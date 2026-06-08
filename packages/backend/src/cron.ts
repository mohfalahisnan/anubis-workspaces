import { Hono } from 'hono'
import { z } from 'zod'
import { getStack } from './services.js'

const UpdateBody = z.object({
  name: z.string().min(1).optional(),
  schedule: z.string().min(1).optional(),
  scheduleDescription: z.string().optional(),
  prompt: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
}).strict()

export const cronRoutes = new Hono()

cronRoutes.get('/', (c) => {
  const conv = c.req.query('conversationId') || undefined
  const projectId = c.req.query('projectId') || undefined
  return c.json({ ok: true, items: getStack().cron.list(conv, projectId) })
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
