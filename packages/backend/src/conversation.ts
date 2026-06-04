import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { NoCredentialsError } from '@anubis/conversation'
import { getStack } from './services.js'

const CreateBody = z.object({
  title: z.string().min(1),
  profileId: z.string().min(1).optional(),
  workspacePath: z.string().min(1).optional(),
  agent: z.enum(['claude', 'codex']).optional(),
  override: z.record(z.string(), z.unknown()).optional(),
}).strict()

const UpdateBody = z.object({
  title: z.string().min(1).optional(),
  archived: z.boolean().optional(),
  override: z.record(z.string(), z.unknown()).optional(),
  profileId: z.string().min(1).nullable().optional(),
  workspacePath: z.string().min(1).optional(),
}).strict()

const SendBody = z.object({
  content: z.string().min(1),
  override: z.record(z.string(), z.unknown()).optional(),
}).strict()

export const conversationRoutes = new Hono()

conversationRoutes.post('/', async (c) => {
  const body = CreateBody.parse(await c.req.json())
  const conv = getStack().conversation.create(body as never)
  return c.json({ ok: true, conversation: conv }, 201)
})

conversationRoutes.get('/', (c) => {
  const limit = Number(c.req.query('limit') ?? 50)
  const archivedRaw = c.req.query('archived')
  const archived = archivedRaw === undefined ? undefined : archivedRaw === 'true'
  return c.json({ ok: true, items: getStack().conversation.list({ limit, archived }) })
})

conversationRoutes.get('/:id', (c) => {
  const conv = getStack().conversation.get(c.req.param('id'))
  if (!conv) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, conversation: conv })
})

conversationRoutes.patch('/:id', async (c) => {
  const body = UpdateBody.parse(await c.req.json())
  const conv = getStack().conversation.update(c.req.param('id'), body as never)
  return c.json({ ok: true, conversation: conv })
})

conversationRoutes.delete('/:id', (c) => {
  getStack().conversation.delete(c.req.param('id'))
  return c.json({ ok: true })
})

conversationRoutes.post('/:id/reset-skills', (c) => {
  const skills = getStack().conversation.resetSkills(c.req.param('id'))
  return c.json({ ok: true, skills })
})

conversationRoutes.post('/:id/messages', async (c) => {
  const body = SendBody.parse(await c.req.json())
  try {
    const r = await getStack().conversation.sendMessage(c.req.param('id'), body as never)
    return c.json({ ok: true, msgId: r.msgId, messageId: r.messageId }, 202)
  } catch (e) {
    if (e instanceof NoCredentialsError) {
      return c.json(
        { ok: false, error: { code: 'no_credentials', profileId: e.profileId, agent: e.agent } },
        409,
      )
    }
    throw e
  }
})

conversationRoutes.get('/:id/messages', (c) => {
  return c.json({ ok: true, items: getStack().conversation.listMessages(c.req.param('id')) })
})

conversationRoutes.post('/:id/cancel', async (c) => {
  await getStack().conversation.cancel(c.req.param('id'))
  return c.json({ ok: true })
})

conversationRoutes.get('/:id/stream', (c) => {
  const id = c.req.param('id')
  return streamSSE(c, async (stream) => {
    const sub = getStack().sse.subscribe(id, async (event) => {
      await stream.writeSSE({ event: event.name, data: JSON.stringify(event.data) })
    })
    // Flush replay (events from the current or just-finished turn) before
    // live events resume. Lets a reconnecting client catch up on partials,
    // tool calls, and tool results it missed while disconnected.
    for (const event of sub.replay) {
      await stream.writeSSE({ event: event.name, data: JSON.stringify(event.data) })
    }
    await new Promise<void>((resolve) => {
      stream.onAbort(() => { sub.unsubscribe(); resolve() })
    })
  })
})
