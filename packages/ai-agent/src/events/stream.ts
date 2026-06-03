import { EventEmitter } from 'node:events'

export interface AgentEventMap {
  partial: { deltaText: string }
  tool_call: { name: string; args: unknown }
  tool_result: { name: string; result: unknown }
  approval_required: { approvalId: string; kind: string; payload: unknown }
  done: { finishReason: string; usage?: unknown }
  error: { error: Error }
  session: { sessionId: string }
}

export class TypedEmitter<M extends Record<string, any>> {
  private e = new EventEmitter()

  on<K extends keyof M>(k: K, h: (p: M[K]) => void): void {
    this.e.on(k as string, h as (...args: unknown[]) => void)
  }

  emit<K extends keyof M>(k: K, p: M[K]): void {
    // Node's EventEmitter throws when 'error' is emitted with zero listeners.
    // In our pipeline the agent may emit 'error' (e.g. ENOENT from a missing
    // codex CLI) before the stream relay has had a chance to attach. Swallow
    // such errors to stderr instead of crashing the whole backend process.
    if (k === 'error' && this.e.listenerCount('error') === 0) {
      // eslint-disable-next-line no-console
      console.error('[TypedEmitter] swallowed error (no listener):', p)
      return
    }
    this.e.emit(k as string, p)
  }

  off<K extends keyof M>(k: K, h: (p: M[K]) => void): void {
    this.e.off(k as string, h as (...args: unknown[]) => void)
  }
}

export type AgentStream = TypedEmitter<AgentEventMap>
