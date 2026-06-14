import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { createReadStream, realpathSync, statSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { getStack } from './services.js'

const CreateBody = z.object({
  title: z.string().min(1),
  profileId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  workspacePath: z.string().min(1).optional(),
  agent: z.enum(['claude', 'codex', 'antigravity', 'gpt-web', 'qwen-web', 'qoder']).optional(),
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
  fileReferences: z.array(z.string().min(1)).optional(),
}).strict()

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

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
  const sourceRaw = c.req.query('source')
  const source = sourceRaw === 'manual' || sourceRaw === 'workflow' ? sourceRaw : undefined
  const projectId = c.req.query('projectId')
  return c.json({ ok: true, items: getStack().conversation.list({ limit, archived, source, projectId }) })
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
  // A `NoCredentialsError` from sendMessage propagates to app.onError, which
  // maps it to the 409 credential-gate response. See http-errors.ts.
  const r = await getStack().conversation.sendMessage(c.req.param('id'), body as never)
  return c.json({ ok: true, msgId: r.msgId, messageId: r.messageId }, 202)
})

conversationRoutes.get('/:id/messages', (c) => {
  return c.json({ ok: true, items: getStack().conversation.listMessages(c.req.param('id')) })
})

conversationRoutes.get('/:id/files', (c) => {
  const conv = getStack().conversation.get(c.req.param('id'))
  if (!conv) return c.json({ error: 'not_found' }, 404)

  const requested = c.req.query('path')
  if (!requested) return c.json({ error: 'missing_path' }, 400)

  const workspaceRoot = resolve(conv.workspacePath)
  const target = resolve(workspaceRoot, requested)
  if (!isPathInside(workspaceRoot, target)) {
    return c.json({ error: 'forbidden' }, 403)
  }

  const contentType = IMAGE_MIME[extname(target).toLowerCase()]
  if (!contentType) return c.json({ error: 'unsupported_media_type' }, 415)

  // Resolve symlinks before re-checking containment, so a symlink inside the
  // workspace can't escape it.
  let realTarget: string
  let realRoot: string
  try {
    realRoot = realpathSync(workspaceRoot)
    realTarget = realpathSync(target)
  } catch {
    return c.json({ error: 'not_found' }, 404)
  }
  if (!isPathInside(realRoot, realTarget)) {
    return c.json({ error: 'forbidden' }, 403)
  }

  try {
    if (!statSync(realTarget).isFile()) return c.json({ error: 'not_found' }, 404)
  } catch {
    return c.json({ error: 'not_found' }, 404)
  }

  const stream = createReadStream(realTarget)
  return c.body(stream as unknown as ReadableStream, 200, {
    'Content-Type': contentType,
    'Cache-Control': 'private, max-age=300',
  })
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

function isPathInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel))
}
