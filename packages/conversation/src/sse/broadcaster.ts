export interface SseEvent {
  name: 'partial' | 'tool_call' | 'tool_result' | 'session' | 'done' | 'error' | 'approval_required' | 'system'
  data: unknown
}

export type SseListener = (e: SseEvent) => void

export class SseBroadcaster {
  private subs = new Map<string, Set<SseListener>>()

  subscribe(conversationId: string, listener: SseListener): () => void {
    let set = this.subs.get(conversationId)
    if (!set) {
      set = new Set()
      this.subs.set(conversationId, set)
    }
    set.add(listener)
    return () => {
      const s = this.subs.get(conversationId)
      if (!s) return
      s.delete(listener)
      if (s.size === 0) this.subs.delete(conversationId)
    }
  }

  publish(conversationId: string, event: SseEvent): void {
    const set = this.subs.get(conversationId)
    if (!set) return
    for (const fn of set) {
      try { fn(event) } catch { /* listener errors must not break fan-out */ }
    }
  }

  subscriberCount(conversationId: string): number {
    return this.subs.get(conversationId)?.size ?? 0
  }
}
