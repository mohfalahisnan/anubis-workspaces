import { serve } from '@hono/node-server'
import app from './app.js'

const hostname = process.env.ANUBIS_BACKEND_HOST ?? '127.0.0.1'
const requestedPort = Number(process.env.ANUBIS_BACKEND_PORT ?? process.env.PORT ?? 0)

const server = serve(
  {
    fetch: app.fetch,
    hostname,
    port: Number.isFinite(requestedPort) ? requestedPort : 0,
  },
  (info) => {
    const url = `http://${hostname}:${info.port}`
    const readyMessage = { type: 'backend-ready', url, port: info.port }

    console.log(JSON.stringify(readyMessage))
  },
)

function shutdown() {
  server.close(() => {
    process.exit(0)
  })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
