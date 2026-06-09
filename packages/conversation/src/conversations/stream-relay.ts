import type { TypedEmitter, AgentEventMap } from '@anubis/ai-agent'
import {
  extractImageReferencesFromUnknown,
  type MessageImageReference,
} from '@anubis/shared'
import { newId } from '../util/ids.js'
import { nowMs } from '../util/time.js'
import { detectCronCommands, type CronCommand } from './cron-detect.js'
import type { ConversationsRepo } from '../db/repositories/conversations-repo.js'
import type { MessagesRepo } from '../db/repositories/messages-repo.js'
import type { ArtifactsRepo } from '../db/repositories/artifacts-repo.js'
import type { AgentSessionsRepo } from '../db/repositories/agent-sessions-repo.js'
import type { SseBroadcaster, SseEvent } from '../sse/broadcaster.js'
import type { AgentKind } from '../profiles/types.js'

export interface StreamRelayOpts {
  conversationId: string
  msgId: string
  messageRowId: string
  conversations: ConversationsRepo
  messages: MessagesRepo
  artifacts: ArtifactsRepo
  sessions: AgentSessionsRepo
  sse: SseBroadcaster
  cronHandler: (cmd: CronCommand, conversationId: string) => Promise<string>
  agent?: AgentKind
  flushEvery?: number
}

export class StreamRelay {
  private buffer = ''
  private chunkCount = 0
  private toolNameByCall = new Map<string, string>()
  private toolArtIdByCall = new Map<string, string>()
  private imageReferences: MessageImageReference[] = []

  constructor(private opts: StreamRelayOpts) {}

  attach(emitter: TypedEmitter<AgentEventMap>): Promise<void> {
    const flushEvery = this.opts.flushEvery ?? 20
    // Pre-create the assistant message row so artifact FK references resolve.
    this.flushAssistant()
    return new Promise<void>((resolve) => {
      emitter.on('partial', (d) => {
        this.buffer += d.deltaText
        this.chunkCount += 1
        if (this.chunkCount % flushEvery === 0) this.flushAssistant()
        this.publish({ name: 'partial', data: d })
      })

      emitter.on('tool_call', (d) => {
        const dx = d as unknown as { id?: string; call_id?: string; name: string; args: unknown }
        const callId = dx.id ?? dx.call_id ?? newId()
        const toolName = dx.name
        this.toolNameByCall.set(callId, toolName)
        const artId = newId()
        this.toolArtIdByCall.set(callId, artId)
        const now = nowMs()
        this.opts.artifacts.insert({
          id: artId, conversationId: this.opts.conversationId, messageId: this.opts.messageRowId,
          kind: 'tool_call', toolName, callId, input: dx.args, status: 'running',
          createdAt: now, updatedAt: now,
        })
        this.publish({ name: 'tool_call', data: { ...d, callId, artifactId: artId } })
      })

      emitter.on('tool_result', (d) => {
        const dx = d as unknown as { id?: string; call_id?: string; name: string; result: unknown; isError?: boolean }
        const status = dx.isError ? 'error' : 'success'
        let callId = dx.id ?? dx.call_id
        if (callId && this.toolArtIdByCall.has(callId)) {
          this.opts.artifacts.updateResult(callId, this.opts.conversationId, dx.result, status)
        } else {
          for (const [cid, name] of this.toolNameByCall) {
            if (name === dx.name) {
              callId = cid
              this.opts.artifacts.updateResult(cid, this.opts.conversationId, dx.result, status)
              break
            }
          }
        }
        this.mergeImageReferences(extractImageReferencesFromUnknown(dx.result))
        this.flushAssistant()
        this.publish({ name: 'tool_result', data: { ...d, callId } })
      })

      emitter.on('session', (d) => {
        if (this.opts.agent) {
          this.opts.sessions.upsert({
            conversationId: this.opts.conversationId,
            agent: this.opts.agent,
            agentSessionId: d.sessionId,
            updatedAt: nowMs(),
          })
        }
        this.publish({ name: 'session', data: d })
      })

      emitter.on('approval_required', (d) => {
        this.publish({ name: 'approval_required', data: d })
      })

      // Both terminal handlers are wrapped in try/finally so resolve() runs
      // even if a downstream side-effect throws (a DB write failure, a
      // publisher exception, a cron handler crash). Without this, anything
      // awaiting the relay's done promise — including the workflow's
      // createAndAwaitFirstTurn — would hang forever.
      emitter.on('done', async (d) => {
        try {
          this.flushAssistant({ finishReason: d.finishReason, usage: d.usage })
          const cmds = detectCronCommands(this.buffer)
          for (const cmd of cmds) {
            try {
              const summary = await this.opts.cronHandler(cmd, this.opts.conversationId)
              const now = nowMs()
              this.opts.messages.insert({
                id: newId(), conversationId: this.opts.conversationId, msgId: this.opts.msgId,
                role: 'system', content: summary, createdAt: now,
              })
              this.publish({ name: 'system', data: { content: summary } })
            } catch (e) {
              this.publish({ name: 'error', data: { error: (e as Error).message } })
            }
          }
          this.opts.conversations.updateStatus(this.opts.conversationId, 'finished')
          this.publish({ name: 'done', data: d })
        } finally {
          resolve()
        }
      })

      emitter.on('error', (d) => {
        try {
          const now = nowMs()
          // If no partials streamed before the failure, fall back to writing
          // the error text into the message body. Otherwise we leave the
          // partial content alone and only attach the error in metadata.
          const errMessage = d.error.message
          const codexInfo = (d.error as { codexErrorInfo?: string }).codexErrorInfo
          const content = this.buffer || `_${errMessage}_`
          this.opts.messages.upsertAssistant({
            id: this.opts.messageRowId, conversationId: this.opts.conversationId,
            msgId: this.opts.msgId, role: 'assistant', content,
            metadata: this.withImageMetadata({
              error: {
                message: errMessage,
                ...(codexInfo ? { codexErrorInfo: codexInfo } : {}),
              },
            }),
            createdAt: now,
          })
          this.opts.conversations.updateStatus(this.opts.conversationId, 'error')
          this.publish({ name: 'error', data: { message: errMessage } })
        } finally {
          resolve()
        }
      })
    })
  }

  private flushAssistant(extraMeta: Record<string, unknown> = {}): void {
    this.opts.messages.upsertAssistant({
      id: this.opts.messageRowId,
      conversationId: this.opts.conversationId,
      msgId: this.opts.msgId,
      role: 'assistant',
      content: this.buffer,
      metadata: this.withImageMetadata(extraMeta),
      createdAt: nowMs(),
    })
  }

  private publish(event: SseEvent): void {
    this.opts.sse.publish(this.opts.conversationId, event)
  }

  private mergeImageReferences(refs: MessageImageReference[]): void {
    if (refs.length === 0) return
    const seen = new Set(this.imageReferences.map((ref) => ref.src))
    for (const ref of refs) {
      if (seen.has(ref.src)) continue
      seen.add(ref.src)
      this.imageReferences.push({ ...ref, source: ref.source ?? 'tool' })
    }
  }

  private withImageMetadata(meta: Record<string, unknown>): Record<string, unknown> | undefined {
    const next: Record<string, unknown> = { ...meta }
    if (this.imageReferences.length > 0) {
      next.imageReferences = this.imageReferences
    }
    return Object.keys(next).length ? next : undefined
  }
}
