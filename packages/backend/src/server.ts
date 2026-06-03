import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'
import app from './app.js'
import { registerLoginPty } from './login-pty.js'
import { ensureExtensionStarted, shutdownStack } from './services.js'

const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app })
registerLoginPty(app, upgradeWebSocket)

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

injectWebSocket(server)

// Lazy-start the extension WS server alongside HTTP startup. Failures
// are logged but don't take down the backend — the /extension/* routes
// will surface a clean error if the user tries to use the extension
// before it recovers.
ensureExtensionStarted().catch((e) => {
  console.error('[extension] failed to start WS server', e)
})

function shutdown() {
  server.close(() => {
    void shutdownStack().finally(() => process.exit(0))
  })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
