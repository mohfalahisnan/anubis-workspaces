import { basename } from 'node:path'
import { TypedEmitter, type AgentEventMap } from '../../events/stream.js'
import type { QoderContentBlock, QoderMessage } from './types.js'

export interface QoderRunOpts {
  workspaceId: string
  sessionId?: string
  /** Prior Qoder session_id to resume. */
  prevSessionId?: string
  cwd: string
  prompt: string
  model?: string
  permissionMode?: string
  allowedTools?: string[]
  disallowedTools?: string[]
  appendSystemPrompt?: string
  files?: string[]
  extraEnv?: Record<string, string>
  /** Qoder personal access token from settings. Preferred over QODER_PERSONAL_ACCESS_TOKEN env var. */
  apiKey?: string
}

export interface QoderAgentOpts {
  env?: NodeJS.ProcessEnv
}

export class QoderAgent {
  constructor(private opts: QoderAgentOpts = {}) {}

  async run(
    opts: QoderRunOpts,
  ): Promise<{ emitter: TypedEmitter<AgentEventMap>; sessionId: string; cancel: () => void }> {
    const sessionId = opts.sessionId ?? ''
    const emitter = new TypedEmitter<AgentEventMap>()

    // Terminal guard — exactly one done|error per run
    let terminalEmitted = false
    emitter.on('done', () => { terminalEmitted = true })
    emitter.on('error', () => { terminalEmitted = true })

    // --- Lazy-import the SDK so missing package doesn't break other agents
    let sdkModule: any
    try {
      sdkModule = await import('@qoder-ai/qoder-agent-sdk')
    } catch {
      queueMicrotask(() => {
        if (!terminalEmitted) {
          emitter.emit('error', {
            error: new Error(
              '@qoder-ai/qoder-agent-sdk is not installed. Run: pnpm add @qoder-ai/qoder-agent-sdk',
            ),
          })
        }
      })
      return { emitter, sessionId, cancel: () => {} }
    }

    const { query, accessToken, accessTokenFromEnv, qodercliAuth } = sdkModule

    // --- Auth: prefer settings key → PAT env var → qodercli session.
    // Build auth via the SDK's own helpers so the shape matches AuthOptions
    // ({ type: 'accessToken', accessToken } | { type: 'qodercli' }). Hand-rolling
    // the object (e.g. { type: 'access_token', token }) leaves `accessToken`
    // undefined and the SDK then writes `undefined` to its auth payload.
    const env = opts.extraEnv
      ? { ...(this.opts.env ?? process.env), ...opts.extraEnv }
      : (this.opts.env ?? process.env)
    const auth = opts.apiKey
      ? accessToken(opts.apiKey)
      : env.QODER_PERSONAL_ACCESS_TOKEN
        ? accessTokenFromEnv()
        : qodercliAuth()

    // --- Map permissionMode
    const permissionMode = opts.permissionMode === 'bypassPermissions'
      ? 'bypassPermissions'
      : opts.permissionMode === 'plan'
        ? 'plan'
        : 'acceptEdits'

    // --- Build system prompt
    let systemPrompt: string | undefined
    if (opts.appendSystemPrompt) {
      systemPrompt = opts.appendSystemPrompt
    }
    if (opts.files?.length) {
      const fileList = opts.files.map(f => basename(f)).join(', ')
      const filesNote = `The user has explicitly attached the following files to this turn: ${fileList}. You can read or edit them in the workspace.`
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${filesNote}` : filesNote
    }

    // --- AbortController for cancellation
    const ac = new AbortController()
    let cancelled = false
    // eslint-disable-next-line prefer-const
    let q: any

    const cancel = () => {
      if (cancelled) return
      cancelled = true
      ac.abort()
      if (q && typeof q.close === 'function') {
        try { q.close() } catch { /* already closed */ }
      }
      if (!terminalEmitted) emitter.emit('done', { finishReason: 'cancelled' })
    }

    // --- Build query options
    const queryOptions: Record<string, unknown> = {
      auth,
      cwd: opts.cwd,
      includePartialMessages: true,
      model: opts.model ?? 'auto',
      permissionMode,
      abortController: ac,
    }
    if (opts.allowedTools?.length) queryOptions.allowedTools = opts.allowedTools
    if (opts.disallowedTools?.length) queryOptions.disallowedTools = opts.disallowedTools
    if (systemPrompt) {
      queryOptions.systemPrompt = { type: 'preset', preset: 'qodercli', append: systemPrompt }
    }
    if (opts.prevSessionId) queryOptions.resume = opts.prevSessionId

    // --- Start the query
    q = query({
      prompt: opts.prompt,
      options: queryOptions,
    })

    // --- Consume the async iterator in the background
    const toolNamesById = new Map<string, string>()
    // With includePartialMessages the SDK streams text twice: incrementally via
    // `stream_event` text deltas AND again as the full block in the final
    // `assistant` message. Emit only the deltas; fall back to the assistant text
    // block only if nothing streamed — otherwise the message content doubles.
    let sawTextDelta = false

    ;(async () => {
      try {
        for await (const msg of q) {
          if (terminalEmitted) break

          const m = msg as QoderMessage
          switch (m.type) {
            case 'stream_event': {
              const delta = m.event?.delta
              if (delta && 'type' in delta && delta.type === 'text_delta' && 'text' in delta) {
                sawTextDelta = true
                emitter.emit('partial', { deltaText: (delta as { text: string }).text })
              }
              break
            }
            case 'assistant': {
              for (const block of m.message.content as QoderContentBlock[]) {
                if (block.type === 'text') {
                  if (!sawTextDelta && block.text) {
                    emitter.emit('partial', { deltaText: block.text })
                  }
                } else if (block.type === 'tool_use') {
                  if (block.id) toolNamesById.set(block.id, block.name)
                  emitter.emit('tool_call', { name: block.name, args: block.input })
                }
              }
              break
            }
            case 'user': {
              for (const block of m.message.content as QoderContentBlock[]) {
                if (block.type === 'tool_result') {
                  emitter.emit('tool_result', {
                    name: toolNamesById.get(block.tool_use_id) ?? block.tool_use_id,
                    result: block.content,
                    isError: block.is_error === true,
                  })
                }
              }
              break
            }
            case 'system': {
              if (m.subtype === 'init' && m.session_id) {
                emitter.emit('session', { sessionId: m.session_id })
              }
              break
            }
            case 'result': {
              if (!terminalEmitted) {
                emitter.emit('done', {
                  finishReason: m.subtype,
                  usage: msg,
                })
              }
              break
            }
          }
        }
        // Iterator exhausted without a result message — emit done defensively
        if (!terminalEmitted) {
          emitter.emit('done', { finishReason: 'stop' })
        }
      } catch (err) {
        if (terminalEmitted) return
        if (cancelled) {
          emitter.emit('done', { finishReason: 'cancelled' })
        } else {
          emitter.emit('error', { error: err instanceof Error ? err : new Error(String(err)) })
        }
      }
    })()

    return { emitter, sessionId, cancel }
  }
}
