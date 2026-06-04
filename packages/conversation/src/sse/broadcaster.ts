export interface SseEvent {
  name: 'partial' | 'tool_call' | 'tool_result' | 'session' | 'done' | 'error' | 'approval_required' | 'system'
  data: unknown
}

export type SseListener = (e: SseEvent) => void

export interface Subscription {
  unsubscribe(): void
  replay: SseEvent[]
}

interface ConvBuffer {
  events: SseEvent[]
  expireTimer?: NodeJS.Timeout
}

const TERMINAL_EVENTS: ReadonlySet<SseEvent['name']> = new Set(['done', 'error'])
const DEFAULT_GRACE_MS = 60_000

export class SseBroadcaster {
  private subs = new Map<string, Set<SseListener>>()
  private buffers = new Map<string, ConvBuffer>()

  constructor(private graceMs: number = DEFAULT_GRACE_MS) {}

  /**
   * Subscribe to a conversation's event stream. The returned `replay` array
   * contains all buffered events from the current (or just-finished) turn so
   * a reconnecting client catches up before live events resume.
   *
   * Buffers cover one turn at a time: a fresh non-terminal event after a
   * terminal one drops the prior turn's events first.
   */
  subscribe(conversationId: string, listener: SseListener): Subscription {
    let set = this.subs.get(conversationId)
    if (!set) {
      set = new Set()
      this.subs.set(conversationId, set)
    }
    set.add(listener)
    const buf = this.buffers.get(conversationId)
    const replay = buf ? [...buf.events] : []
    return {
      replay,
      unsubscribe: () => {
        const s = this.subs.get(conversationId)
        if (!s) return
        s.delete(listener)
        if (s.size === 0) this.subs.delete(conversationId)
      },
    }
  }

  publish(conversationId: string, event: SseEvent): void {
    let buf = this.buffers.get(conversationId)
    if (!buf) {
      buf = { events: [] }
      this.buffers.set(conversationId, buf)
    }
    // A non-terminal event arriving after a terminal one means a new turn is
    // starting — drop the prior turn's buffer first so we don't replay stale
    // partials/tool calls into the next turn's reconnects.
    if (buf.expireTimer && !TERMINAL_EVENTS.has(event.name)) {
      clearTimeout(buf.expireTimer)
      buf.expireTimer = undefined
      buf.events = []
    }
    buf.events.push(event)

    const set = this.subs.get(conversationId)
    if (set) {
      for (const fn of set) {
        try { fn(event) } catch { /* listener errors must not break fan-out */ }
      }
    }

    if (TERMINAL_EVENTS.has(event.name)) {
      if (buf.expireTimer) clearTimeout(buf.expireTimer)
      buf.expireTimer = setTimeout(() => {
        this.buffers.delete(conversationId)
      }, this.graceMs)
      buf.expireTimer.unref?.()
    }
  }

  subscriberCount(conversationId: string): number {
    return this.subs.get(conversationId)?.size ?? 0
  }
}
