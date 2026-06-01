import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { ApiHealthResponse } from '@anubis/shared'

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
