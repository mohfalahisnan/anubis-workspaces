import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { ApiHealthResponse } from '@anubis/shared'
import { toErrorResponse } from './http-errors.js'
import { researchCrawlerRoutes } from './research-crawler.js'
import { aiAgentRoutes } from './ai-agent.js'
import { conversationRoutes } from './conversation.js'
import { profileRoutes } from './profile.js'
import { skillRoutes } from './skill.js'
import { cronRoutes } from './cron.js'
import { competitorRoutes } from './competitors.js'
import { captureRoutes, postRoutes } from './captures.js'
import { configRoutes } from './config.js'
import { systemRoutes } from './system.js'
import { workflowRoutes } from './workflow.js'
import { workspaceRoutes } from './workspaces.js'
import { projectRoutes } from './projects.js'
import { contentItemRoutes } from './content-items.js'
import { taskRoutes } from './tasks.js'
import { extractorRoutes } from './extractor.js'
import { knowledgeBaseRoutes } from './knowledge-base.js'
import { jobRoutes } from './jobs.js'
import { snapshotRoutes } from './snapshot.js'
import { researchRoutes } from './research.js'
import { brandContextRoutes, lessonRoutes } from './brand-context.js'

const app = new Hono()

// Request logging — prints "--> METHOD /path" and "<-- status (ms)" for every
// request. In the desktop app these land in the Electron main console (the
// terminal running `pnpm dev`) because the main process forwards backend
// stdout; see apps/desktop/electron/main/backend.ts.
app.use('*', logger())

app.use('*', cors({
  origin: (origin) => {
    if (isAllowedLocalOrigin(origin)) {
      return origin
    }

    return undefined
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

app.get('/health', (c) => {
  const body: ApiHealthResponse = {
    ok: true,
    service: 'anubis-backend',
    time: new Date().toISOString(),
  }

  return c.json(body)
})

app.route('/research-crawler', researchCrawlerRoutes)
app.route('/ai-agent', aiAgentRoutes)
app.route('/conversations', conversationRoutes)
app.route('/profiles', profileRoutes)
app.route('/skills', skillRoutes)
app.route('/cron-jobs', cronRoutes)
app.route('/competitors', competitorRoutes)
app.route('/captures', captureRoutes)
app.route('/posts', postRoutes)
app.route('/config', configRoutes)
app.route('/system', systemRoutes)
app.route('/workflows', workflowRoutes)
app.route('/workspaces', workspaceRoutes)
app.route('/projects', projectRoutes)
app.route('/content-items', contentItemRoutes)
app.route('/tasks', taskRoutes)
app.route('/extractor', extractorRoutes)
app.route('/knowledge-base', knowledgeBaseRoutes)
app.route('/jobs', jobRoutes)
app.route('/snapshot', snapshotRoutes)
app.route('/research', researchRoutes)
app.route('/brand-context', brandContextRoutes)
app.route('/lessons', lessonRoutes)

app.onError((error, c) => {
  const { status, body } = toErrorResponse(error)
  if (status >= 500) {
    console.error(`[backend] ${status} ${c.req.method} ${c.req.path} —`, error)
  } else {
    console.warn(`[backend] ${status} ${c.req.method} ${c.req.path}`)
  }
  return c.json(body, status)
})

export default app

function isAllowedLocalOrigin(origin: string) {
  try {
    const url = new URL(origin)

    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1')
    )
  } catch {
    return false
  }
}
