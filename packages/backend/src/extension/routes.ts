import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { ensureExtensionStarted, getStack, getExtensionWS } from '../services.js'

/* -----------------------------------------------------------
   /extension routes
   -----------------------------------------------------------
   Status, secret reveal/rotate. The actual WS bind/listen
   happens via ensureExtensionStarted() in services.ts; this
   file calls it lazily for routes that need it.
   ----------------------------------------------------------- */

export const extensionRoutes = new Hono()

extensionRoutes.get('/status', async (c) => {
  await ensureExtensionStarted()
  const stack = getStack()
  const ws = getExtensionWS()
  const dataDir = process.env.ANUBIS_DATA_DIR ?? join(tmpdir(), 'anubis')
  return c.json({
    ok: true,
    status: {
      connected: ws?.isConnected() ?? false,
      extensionVersion: ws?.connectedExtensionVersion(),
      pairedAt: ws?.pairedAt() ?? stack.appConfig.get().extensionPairedAt,
      port: stack.appConfig.get().extensionPort ?? 0,
      dataDirPath: join(dataDir, 'extension'),
    },
  })
})

extensionRoutes.post('/secret/reveal', (c) => {
  const secret = getStack().appConfig.get().extensionSecret ?? ''
  return c.json({ ok: true, secret })
})

extensionRoutes.post('/secret/rotate', (c) => {
  // Inline randomHex (we can't reuse the one in app-config.ts; it's private).
  const buf = new Uint8Array(32)
  globalThis.crypto.getRandomValues(buf)
  const secret = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
  const cfg = getStack().appConfig.update({ extensionSecret: secret })
  // Force-disconnect any active client so it re-pairs with the new secret.
  getExtensionWS()?.forceDisconnect('secret-rotated')
  return c.json({ ok: true, secret: cfg.extensionSecret })
})
