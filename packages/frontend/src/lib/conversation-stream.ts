import { useEffect, useRef, useState } from 'react'
import type { MessageSummary } from '@anubis/shared'
import { getApiBaseUrl, listMessages } from '@/api'

export type ToolEvent =
  | { kind: 'call'; callId: string; name: string; args: unknown }
  | { kind: 'result'; callId: string; name: string; result: unknown }

export type Fragment =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; callId: string }

export interface LiveAssistantMessage {
  id: string
  role: 'assistant'
  fragments: Fragment[]
  toolEvents: Record<string, ToolEvent>
  startedAt: number
}

export interface ConversationStreamState {
  messages: MessageSummary[]
  streaming: LiveAssistantMessage | null
  error: string | null
  chunks: number
  partialChars: number
}

export function useConversationMessages(
  conversationId: string | undefined,
): ConversationStreamState {
  const [messages, setMessages] = useState<MessageSummary[]>([])
  const [streaming, setStreaming] = useState<LiveAssistantMessage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chunks, setChunks] = useState(0)
  const [partialChars, setPartialChars] = useState(0)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!conversationId) return
    let cancelled = false

    listMessages(conversationId)
      .then((items) => {
        if (!cancelled) setMessages(items)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })

    let es: EventSource | null = null
    void getApiBaseUrl().then((baseUrl) => {
      if (cancelled) return
      const url = new URL(
        `/conversations/${encodeURIComponent(conversationId)}/stream`,
        baseUrl,
      )
      es = new EventSource(url.toString())
      esRef.current = es

      const ensureStreaming = (): LiveAssistantMessage => ({
        id: `streaming:${Date.now()}`,
        role: 'assistant',
        fragments: [],
        toolEvents: {},
        startedAt: Date.now(),
      })

      es.addEventListener('partial', (raw) => {
        const data = parseSse<{ deltaText: string }>(raw)
        if (!data) return
        setChunks((c) => c + 1)
        setPartialChars((p) => p + data.deltaText.length)
        setStreaming((cur) => {
          const next = cur ?? ensureStreaming()
          const last = next.fragments[next.fragments.length - 1]
          if (last && last.kind === 'text') {
            return {
              ...next,
              fragments: [
                ...next.fragments.slice(0, -1),
                { kind: 'text', text: last.text + data.deltaText },
              ],
            }
          }
          return { ...next, fragments: [...next.fragments, { kind: 'text', text: data.deltaText }] }
        })
      })

      es.addEventListener('tool_call', (raw) => {
        const data = parseSse<{ callId: string; name: string; args: unknown }>(raw)
        if (!data) return
        setStreaming((cur) => {
          const next = cur ?? ensureStreaming()
          return {
            ...next,
            fragments: [...next.fragments, { kind: 'tool', callId: data.callId }],
            toolEvents: {
              ...next.toolEvents,
              [data.callId]: { kind: 'call', callId: data.callId, name: data.name, args: data.args },
            },
          }
        })
      })

      es.addEventListener('tool_result', (raw) => {
        const data = parseSse<{ callId: string; name: string; result: unknown }>(raw)
        if (!data) return
        setStreaming((cur) => {
          if (!cur) return cur
          return {
            ...cur,
            toolEvents: {
              ...cur.toolEvents,
              [data.callId]: {
                kind: 'result',
                callId: data.callId,
                name: data.name,
                result: data.result,
              },
            },
          }
        })
      })

      es.addEventListener('system', (raw) => {
        const data = parseSse<{ content: string }>(raw)
        if (!data) return
        setMessages((m) => [
          ...m,
          {
            id: `system:${Date.now()}`,
            conversationId,
            msgId: `system:${Date.now()}`,
            role: 'system',
            content: data.content,
            createdAt: Date.now(),
          },
        ])
      })

      es.addEventListener('done', () => {
        setStreaming(null)
        listMessages(conversationId)
          .then((items) => {
            if (!cancelled) setMessages(items)
          })
          .catch(() => {})
        es?.close()
      })

      es.addEventListener('error', (raw) => {
        // The 'error' DOM event on EventSource is a plain Event without a
        // .data payload — fired when the connection drops or fails.
        // Server-sent 'error' events arrive on the message channel as
        // MessageEvent; the cast guards both shapes.
        const msg = raw as Partial<MessageEvent>
        if (typeof msg.data === 'string') {
          const data = parseSse<{ message?: string }>(msg as MessageEvent)
          if (data?.message) setError(data.message)
        } else if (es && es.readyState === EventSource.CLOSED) {
          setError('connection closed')
        }
      })

      es.addEventListener('approval_required', (raw) => {
        // Out of scope for the MDX rendering work — log for now.
        // eslint-disable-next-line no-console
        console.info('[anubis] approval_required (no UI yet):', raw.data)
      })
    })

    return () => {
      cancelled = true
      esRef.current?.close()
      esRef.current = null
    }
  }, [conversationId])

  return { messages, streaming, error, chunks, partialChars }
}

function parseSse<T>(raw: MessageEvent): T | null {
  try {
    return JSON.parse(raw.data) as T
  } catch {
    return null
  }
}
