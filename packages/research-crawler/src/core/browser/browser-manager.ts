import { connectCdpConnection, type CdpConnection } from './cdp-connection.js'
import { createCommandQueue } from './command-queue.js'
import { createSemaphore } from './semaphore.js'
import { createTab, type Tab } from './tab.js'
import { createTabRegistry, type TabRecord } from './tab-registry.js'
import { listChromeTargets, normalizeChromeOrigin, type ChromeTarget } from '../chrome/chrome-connector.js'

export type ConnectFn = (browserWsUrl: string) => Promise<CdpConnection>

export type BrowserManagerOptions = {
  chromeOrigin: string
  fetchImpl?: typeof fetch
  /** Browser-level CdpConnection factory (defaults to the real WebSocket connector). */
  connect?: ConnectFn
  /** Max tabs that may be active inside withTab() at once (default 4). */
  maxConcurrentTabs?: number
  /** Per-command timeout for tabs created by this manager (ms; 0/undefined = none). */
  commandTimeoutMs?: number
}

export type WithTabOptions = {
  /** Open a fresh tab at this URL. */
  url?: string
  /** Or attach to an existing page target matching this predicate. */
  predicate?: (target: ChromeTarget) => boolean
  /** Leave the tab open after fn returns (default false). */
  keepOpen?: boolean
}

export type BrowserManager = {
  readonly chromeOrigin: string
  newTab(url: string): Promise<Tab>
  attachExisting(predicate: (target: ChromeTarget) => boolean): Promise<Tab>
  attach(target: ChromeTarget): Promise<Tab>
  withTab<T>(options: WithTabOptions, fn: (tab: Tab) => Promise<T>): Promise<T>
  listTabs(): TabRecord[]
  isOpen(): boolean
  close(): Promise<void>
}

export async function createBrowserManager(options: BrowserManagerOptions): Promise<BrowserManager> {
  const chromeOrigin = normalizeChromeOrigin(options.chromeOrigin)
  const fetchImpl = options.fetchImpl ?? fetch
  const connect = options.connect ?? connectCdpConnection
  const registry = createTabRegistry()
  const semaphore = createSemaphore(options.maxConcurrentTabs ?? 4)

  const browserWsUrl = await getBrowserWebSocketUrl(chromeOrigin, fetchImpl)
  const connection = await connect(browserWsUrl)

  connection.on('Target.targetDestroyed', (params) => {
    const targetId = (params as { targetId?: string })?.targetId
    if (!targetId) return
    const record = registry.getByTargetId(targetId)
    if (record) registry.remove(record.tabId)
  })
  connection.on('Target.detachedFromTarget', (params) => {
    const sessionId = (params as { sessionId?: string })?.sessionId
    if (!sessionId) return
    const record = registry.getBySessionId(sessionId)
    if (record) registry.remove(record.tabId)
  })

  let tabSeq = 0

  const onClose = async (tabId: string): Promise<void> => {
    const record = registry.get(tabId)
    if (!record) return
    try { await connection.send('Target.closeTarget', { targetId: record.targetId }) } catch { /* best-effort */ }
    registry.remove(tabId)
  }

  const register = (targetId: string, sessionId: string, url: string): Tab => {
    const record: TabRecord = {
      tabId: `tab-${++tabSeq}`, targetId, sessionId, url, state: 'open', queue: createCommandQueue(),
    }
    registry.add(record)
    return createTab({ record, connection, onClose, commandTimeoutMs: options.commandTimeoutMs })
  }

  const attachTo = async (targetId: string): Promise<string> => {
    const res = await connection.send<{ sessionId?: string }>('Target.attachToTarget', { targetId, flatten: true })
    if (!res?.sessionId) throw new Error(`Target.attachToTarget returned no sessionId for ${targetId}.`)
    return res.sessionId
  }

  const manager: BrowserManager = {
    chromeOrigin,

    async newTab(url) {
      const created = await connection.send<{ targetId?: string }>('Target.createTarget', { url })
      if (!created?.targetId) throw new Error('Target.createTarget returned no targetId.')
      const sessionId = await attachTo(created.targetId)
      return register(created.targetId, sessionId, url)
    },

    async attachExisting(predicate) {
      const targets = await listChromeTargets({ chromeOrigin, fetchImpl })
      const target = targets.find((t) => t.type === 'page' && predicate(t))
      if (!target) throw new Error('No matching Chrome page target was found to attach to.')
      const sessionId = await attachTo(target.id)
      return register(target.id, sessionId, target.url)
    },

    async attach(target) {
      const sessionId = await attachTo(target.id)
      return register(target.id, sessionId, target.url)
    },

    async withTab(opts, fn) {
      const release = await semaphore.acquire()
      try {
        const tab = opts.url
          ? await manager.newTab(opts.url)
          : await manager.attachExisting(opts.predicate ?? (() => true))
        try {
          return await fn(tab)
        } finally {
          if (!opts.keepOpen) await tab.close()
        }
      } finally {
        release()
      }
    },

    listTabs() { return registry.list() },
    isOpen() { return connection.isOpen() },

    async close() {
      for (const record of registry.list()) {
        try { await connection.send('Target.closeTarget', { targetId: record.targetId }) } catch { /* best-effort */ }
        registry.remove(record.tabId)
      }
      connection.close()
    },
  }

  return manager
}

async function getBrowserWebSocketUrl(chromeOrigin: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(new URL('/json/version', chromeOrigin))
  if (!response.ok) throw new Error(`Chrome /json/version failed with status ${response.status}.`)
  const payload = (await response.json()) as { webSocketDebuggerUrl?: string }
  if (typeof payload.webSocketDebuggerUrl !== 'string' || !payload.webSocketDebuggerUrl) {
    throw new Error('Chrome /json/version did not return a browser webSocketDebuggerUrl.')
  }
  return payload.webSocketDebuggerUrl
}
