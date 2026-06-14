import { Hono } from 'hono'
import { getStack } from './services.js'

export const lessonRoutes = new Hono()

lessonRoutes.get('/', (c) => {
  const projectId = new URL(c.req.url).searchParams.get('projectId') ?? 'default'
  return c.json({ ok: true, lessons: getStack().contentLessons.listByProject(projectId) })
})
