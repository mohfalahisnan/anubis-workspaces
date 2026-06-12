import type { CommandQueue } from './command-queue.js'

export type TabState = 'open' | 'closing' | 'closed'

export type TabRecord = {
  tabId: string
  targetId: string
  sessionId: string
  url: string
  state: TabState
  queue: CommandQueue
}

export type TabRegistry = {
  add(record: TabRecord): void
  get(tabId: string): TabRecord | undefined
  getByTargetId(targetId: string): TabRecord | undefined
  getBySessionId(sessionId: string): TabRecord | undefined
  remove(tabId: string): void
  list(): TabRecord[]
}

export function createTabRegistry(): TabRegistry {
  const byTabId = new Map<string, TabRecord>()
  return {
    add(record) { byTabId.set(record.tabId, record) },
    get(tabId) { return byTabId.get(tabId) },
    getByTargetId(targetId) {
      for (const record of byTabId.values()) if (record.targetId === targetId) return record
      return undefined
    },
    getBySessionId(sessionId) {
      for (const record of byTabId.values()) if (record.sessionId === sessionId) return record
      return undefined
    },
    remove(tabId) { byTabId.delete(tabId) },
    list() { return [...byTabId.values()] },
  }
}
