import { existsSync } from 'node:fs'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Profile } from '@anubis/conversation'
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

/**
 * Enriches a profile payload with the on-disk path of its isolated
 * agent home, so the UI can surface "Home: …/agent-homes/<id>/<agent>"
 * and offer a "Reset" affordance.
 */
function withHome(profile: Profile) {
  const path = getStack().conversation.agentHomePath(profile.id, profile.config.agent)
  return {
    ...profile,
    home: {
      path,
      exists: existsSync(path),
    },
  }
}

export const profileRoutes = new Hono()

profileRoutes.get('/', (c) => {
  const items = getStack().profiles.list().map(withHome)
  return c.json({ ok: true, items })
})

profileRoutes.get('/:id', (c) => {
  const p = getStack().profiles.get(c.req.param('id'))
  if (!p) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, profile: withHome(p) })
})

profileRoutes.post('/', async (c) => {
  const body = CreateBody.parse(await c.req.json())
  const p = getStack().profiles.create(body as never)
  return c.json({ ok: true, profile: withHome(p) }, 201)
})

profileRoutes.patch('/:id', async (c) => {
  const body = UpdateBody.parse(await c.req.json())
  const p = getStack().profiles.update(c.req.param('id'), body as never)
  return c.json({ ok: true, profile: withHome(p) })
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

profileRoutes.post('/:id/reset-home', (c) => {
  const id = c.req.param('id')
  const p = getStack().profiles.get(id)
  if (!p) return c.json({ ok: false, error: 'not_found' }, 404)
  const result = getStack().conversation.resetProfileHome(id, p.config.agent)
  return c.json({ ok: true, existed: result.existed })
})
