import type { CdpConnection, CdpEventHandler } from './cdp-connection.js'
import type { TabRecord } from './tab-registry.js'

export type Tab = {
  readonly tabId: string
  readonly targetId: string
  readonly sessionId: string
  navigate(url: string): Promise<void>
  evaluate<T = unknown>(expression: string): Promise<T>
  click(selector: string): Promise<void>
  type(selector: string, text: string): Promise<void>
  screenshot(): Promise<string>
  /** Escape hatch: send any CDP command on this tab's session, through the queue. */
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  /** Subscribe to a session-scoped CDP event. Returns an unsubscribe fn. */
  on(method: string, handler: CdpEventHandler): () => void
  close(): Promise<void>
}

export type CreateTabArgs = {
  record: TabRecord
  connection: CdpConnection
  /** Closes the underlying target and removes the tab from the registry. */
  onClose: (tabId: string) => Promise<void>
}

export function createTab({ record, connection, onClose }: CreateTabArgs): Tab {
  const send = <T = unknown>(method: string, params: Record<string, unknown> = {}) =>
    record.queue.run(() => connection.send<T>(method, params, record.sessionId))

  return {
    get tabId() { return record.tabId },
    get targetId() { return record.targetId },
    get sessionId() { return record.sessionId },

    navigate(url) {
      return record.queue.run(async () => {
        await connection.send('Page.enable', {}, record.sessionId)
        await connection.send('Page.navigate', { url }, record.sessionId)
        record.url = url
      })
    },

    async evaluate<T = unknown>(expression: string) {
      const res = await send<{ result?: { value?: unknown } }>('Runtime.evaluate', {
        expression,
        returnByValue: true,
      })
      return res?.result?.value as T
    },

    async click(selector) {
      const literal = JSON.stringify(selector)
      await send('Runtime.evaluate', {
        expression: `(() => { const el = document.querySelector(${literal}); if (!el) throw new Error('selector not found: ' + ${literal}); el.click(); })()`,
      })
    },

    async type(selector, text) {
      const sel = JSON.stringify(selector)
      const val = JSON.stringify(text)
      await send('Runtime.evaluate', {
        expression: `(() => { const el = document.querySelector(${sel}); if (!el) throw new Error('selector not found: ' + ${sel}); el.focus(); el.value = ${val}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`,
      })
    },

    async screenshot() {
      const res = await send<{ data?: string }>('Page.captureScreenshot', {})
      return res?.data ?? ''
    },

    send,

    on(method, handler) {
      return connection.on(method, handler, record.sessionId)
    },

    async close() {
      if (record.state !== 'open') return
      record.state = 'closing'
      await onClose(record.tabId)
      record.state = 'closed'
    },
  }
}
