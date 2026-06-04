import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { ZodError } from 'zod'
import type { ApiHealthResponse } from '@anubis/shared'
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

const app = new Hono()

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

app.onError((error, c) => {
  if (error instanceof ZodError) {
    return c.json({
      ok: false,
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid request body.',
        issues: error.issues,
      },
    }, 400)
  }

  return c.json({
    ok: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
    },
  }, 500)
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
