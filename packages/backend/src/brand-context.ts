import { Hono } from 'hono'
import { z } from 'zod'
import { getStack } from './services.js'

const BrandBody = z.object({
  brandGuideline: z.string().default(''),
  toneOfVoice: z.string().default(''),
  targetAudience: z.string().default(''),
  nichePositioning: z.string().default(''),
  contentRules: z.string().default(''),
}).strict()

export const brandContextRoutes = new Hono()

brandContextRoutes.get('/', (c) => {
  const projectId = new URL(c.req.url).searchParams.get('projectId') ?? 'default'
  return c.json({ ok: true, brandContext: getStack().brandContext.get(projectId) })
})

brandContextRoutes.put('/', async (c) => {
  const projectId = new URL(c.req.url).searchParams.get('projectId') ?? 'default'
  const fields = BrandBody.parse(await c.req.json())
  return c.json({ ok: true, brandContext: getStack().brandContext.save(projectId, fields) })
})

export const lessonRoutes = new Hono()

lessonRoutes.get('/', (c) => {
  const projectId = new URL(c.req.url).searchParams.get('projectId') ?? 'default'
  return c.json({ ok: true, lessons: getStack().contentLessons.listByProject(projectId) })
})
