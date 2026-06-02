import { Hono } from 'hono'
import { z } from 'zod'
import { getStack } from './services.js'

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/

const CreateBody = z.object({
  handle: z.string().min(1),
  displayName: z.string().min(1).optional(),
  niche: z.string().min(1).optional(),
  tint: z.string().regex(HEX_COLOR).optional(),
  followers: z.number().int().nonnegative().optional(),
  avgLikes: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
}).strict()

const UpdateBody = z.object({
  displayName: z.string().min(1).optional(),
  niche: z.string().min(1).optional(),
  tint: z.string().regex(HEX_COLOR).optional(),
  followers: z.number().int().nonnegative().optional(),
  avgLikes: z.number().int().nonnegative().optional(),
  postCount: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
}).strict()

export const competitorRoutes = new Hono()

competitorRoutes.get('/', (c) => {
  return c.json({ ok: true, items: getStack().competitors.list() })
})

competitorRoutes.get('/:id', (c) => {
  const competitor = getStack().competitors.get(c.req.param('id'))
  if (!competitor) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, competitor })
})

competitorRoutes.post('/', async (c) => {
  const body = CreateBody.parse(await c.req.json())
  const competitor = getStack().competitors.create(body)
  return c.json({ ok: true, competitor }, 201)
})

competitorRoutes.patch('/:id', async (c) => {
  const body = UpdateBody.parse(await c.req.json())
  const competitor = getStack().competitors.update(c.req.param('id'), body)
  return c.json({ ok: true, competitor })
})

competitorRoutes.delete('/:id', (c) => {
  getStack().competitors.remove(c.req.param('id'))
  return c.json({ ok: true })
})
