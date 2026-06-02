import { Hono } from 'hono'
import { z } from 'zod'
import { getStack } from './services.js'

const ProfileConfig = z.object({
  agent: z.enum(['claude', 'codex']),
}).passthrough()

const CreateBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  config: ProfileConfig,
}).strict()

const UpdateBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  configPatch: z.record(z.string(), z.unknown()).optional(),
  sortOrder: z.number().int().optional(),
}).strict()

const ResolveBody = z.object({
  override: z.record(z.string(), z.unknown()).optional(),
}).strict()

export const profileRoutes = new Hono()

profileRoutes.get('/', (c) => c.json({ ok: true, items: getStack().profiles.list() }))

profileRoutes.get('/:id', (c) => {
  const p = getStack().profiles.get(c.req.param('id'))
  if (!p) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, profile: p })
})

profileRoutes.post('/', async (c) => {
  const body = CreateBody.parse(await c.req.json())
  const p = getStack().profiles.create(body as never)
  return c.json({ ok: true, profile: p }, 201)
})

profileRoutes.patch('/:id', async (c) => {
  const body = UpdateBody.parse(await c.req.json())
  const p = getStack().profiles.update(c.req.param('id'), body as never)
  return c.json({ ok: true, profile: p })
})

profileRoutes.delete('/:id', (c) => {
  getStack().profiles.delete(c.req.param('id'))
  return c.json({ ok: true })
})

profileRoutes.post('/:id/resolve', async (c) => {
  const body = ResolveBody.parse(await c.req.json().catch(() => ({})))
  const r = getStack().profiles.resolve(c.req.param('id'), body.override as never)
  return c.json({ ok: true, resolved: r })
})
