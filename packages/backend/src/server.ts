import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'
import app from './app.js'
import { registerLoginPty } from './login-pty.js'
import { getDataDir, getStack, shutdownStack } from './services.js'
import { rearmTriggersOnBoot, shutdownTriggers } from './workflow.js'

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

    // Expose the resolved URL process-wide so the conversation layer can inject
    // it into agent system prompts (the port is dynamic in dev). Read lazily via
    // a getter at send time, so ordering vs. stack construction doesn't matter.
    process.env.ANUBIS_BACKEND_URL = url

    console.log(JSON.stringify(readyMessage))

    try {
      const dataDir = getDataDir()
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(join(dataDir, 'backend.port'), url, 'utf8')
    } catch {
      // Non-fatal: agents fall back to env var / port probing
    }

    try {
      rearmTriggersOnBoot(getStack())
    } catch (err) {
      console.error('[trigger] boot rearm failed', err)
    }
  },
)

injectWebSocket(server)

function shutdown() {
  try { unlinkSync(join(getDataDir(), 'backend.port')) } catch { /* already gone */ }
  shutdownTriggers()
  server.close(() => {
    void shutdownStack().finally(() => process.exit(0))
  })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
