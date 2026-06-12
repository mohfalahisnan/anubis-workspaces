import { createBrowserManager, type BrowserManager, type BrowserManagerOptions } from './browser-manager.js'
import { normalizeChromeOrigin } from '../chrome/chrome-connector.js'

export type BrowserRegistry = {
  /** Get (or create) the manager for an origin. Reuses a live one; recreates a closed one. */
  get(options: BrowserManagerOptions): Promise<BrowserManager>
  closeAll(): Promise<void>
}

export function createBrowserRegistry(): BrowserRegistry {
  const managers = new Map<string, BrowserManager>()
  return {
    async get(options) {
      const key = normalizeChromeOrigin(options.chromeOrigin)
      const existing = managers.get(key)
      if (existing && existing.isOpen()) return existing
      const manager = await createBrowserManager(options)
      managers.set(key, manager)
      return manager
    },
    async closeAll() {
      for (const manager of managers.values()) {
        try { await manager.close() } catch { /* best-effort */ }
      }
      managers.clear()
    },
  }
}

/** Process-wide registry for app use (one manager per Chrome origin). */
export const browserRegistry: BrowserRegistry = createBrowserRegistry()
