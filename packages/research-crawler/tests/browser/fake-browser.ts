import { createBrowserManager, type BrowserManager } from '../../src/core/browser/browser-manager.js'
import type { CdpConnection, CdpEventHandler } from '../../src/core/browser/cdp-connection.js'

/** The subset of the legacy CdpSession a mock provides. */
export type SessionLike = {
  send(method: string, params?: any): Promise<any>
  on(method: string, handler: (params: unknown) => void): void
  close?(): void
}

const inertSession: SessionLike = { async send() { return {} }, on() {} }

/**
 * Fake multiplexed CdpConnection that handles Target.* itself (so newTab/attach
 * work) and forwards every other command/subscription to a legacy-style mock
 * session. Mocks that drive their own Network.* events via stored listeners keep
 * working unchanged: their on() registers the handler and their
 * send('Network.enable') fires it.
 */
export function fakeBrowserConnection(session: SessionLike = inertSession): CdpConnection {
  let targetSeq = 0
  let sessionSeq = 0
  return {
    async send(method, params) {
      if (method === 'Target.createTarget') return { targetId: `T${++targetSeq}` } as never
      if (method === 'Target.attachToTarget') return { sessionId: `S${++sessionSeq}` } as never
      if (method === 'Target.closeTarget') return { success: true } as never
      return session.send(method, params) as never
    },
    on(method, handler: CdpEventHandler) {
      session.on(method, handler as (p: unknown) => void)
      return () => {}
    },
    onClose() {}, isOpen() { return true }, close() {},
  }
}

export function fakeFetch(targets: unknown[] = []): typeof fetch {
  return (async (input: unknown) => {
    const url = new URL(String(input))
    if (url.pathname === '/json/version') return { ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://browser' }) } as unknown as Response
    if (url.pathname === '/json/list') return { ok: true, json: async () => targets } as unknown as Response
    throw new Error(`unexpected fetch ${url.pathname}`)
  }) as unknown as typeof fetch
}

/** getManager seam returning ONE cached manager backed by the given mock session. */
export function fakeGetManager(session: SessionLike = inertSession, targets: unknown[] = []): () => Promise<BrowserManager> {
  let cached: BrowserManager | undefined
  return async () => {
    if (cached && cached.isOpen()) return cached
    cached = await createBrowserManager({
      chromeOrigin: 'http://127.0.0.1:9222',
      fetchImpl: fakeFetch(targets),
      connect: async () => fakeBrowserConnection(session),
    })
    return cached
  }
}
