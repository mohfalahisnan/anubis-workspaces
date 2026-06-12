export type CdpEventHandler = (params: unknown) => void | Promise<void>

type WebSocketLike = {
  readyState: number
  send: (data: string) => void
  close: () => void
  addEventListener: (
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: { data?: unknown; error?: unknown }) => void,
  ) => void
}

export type WebSocketConstructor = new (url: string) => WebSocketLike

export type CdpConnection = {
  /** Send a CDP command. Omit sessionId for browser-level commands. */
  send<T = unknown>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T>
  /** Subscribe to a CDP event. Pass sessionId to scope to one tab. Returns an unsubscribe fn. */
  on(method: string, handler: CdpEventHandler, sessionId?: string): () => void
  /** Register a callback fired once when the underlying socket closes. */
  onClose(handler: () => void): void
  isOpen(): boolean
  close(): void
}

type CdpInbound = {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { message?: string }
  sessionId?: string
}

const SEP = ' '
const eventKey = (sessionId: string | undefined, method: string) => `${sessionId ?? ''}${SEP}${method}`

export async function connectCdpConnection(
  browserWsUrl: string,
  webSocketConstructor: WebSocketConstructor = getGlobalWebSocket(),
): Promise<CdpConnection> {
  const socket = new webSocketConstructor(browserWsUrl)
  await waitForSocketOpen(socket)

  let nextId = 1
  let open = true
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const handlers = new Map<string, CdpEventHandler[]>()
  const closeHandlers: Array<() => void> = []

  socket.addEventListener('message', (event) => {
    const message = parseMessage(event.data)
    if (!message) return
    if (typeof message.id === 'number') {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      if (message.error) entry.reject(new Error(message.error.message || 'CDP command failed.'))
      else entry.resolve(message.result)
      return
    }
    if (message.method) {
      const list = handlers.get(eventKey(message.sessionId, message.method))
      if (list) for (const handler of [...list]) void handler(message.params)
    }
  })

  socket.addEventListener('close', () => {
    open = false
    for (const entry of pending.values()) entry.reject(new Error('CDP connection closed.'))
    pending.clear()
    for (const handler of [...closeHandlers]) handler()
  })

  return {
    send<T = unknown>(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
      if (!open) return Promise.reject(new Error('CDP connection closed.'))
      const id = nextId++
      const command: Record<string, unknown> = { id, method, params }
      if (sessionId) command.sessionId = sessionId
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
        socket.send(JSON.stringify(command))
      })
    },
    on(method, handler, sessionId) {
      const key = eventKey(sessionId, method)
      handlers.set(key, [...(handlers.get(key) ?? []), handler])
      return () => {
        const list = handlers.get(key)
        if (!list) return
        const next = list.filter((h) => h !== handler)
        if (next.length) handlers.set(key, next)
        else handlers.delete(key)
      }
    },
    onClose(handler) { closeHandlers.push(handler) },
    isOpen() { return open },
    close() { socket.close() },
  }
}

function waitForSocketOpen(socket: WebSocketLike): Promise<void> {
  if (socket.readyState === 1) return Promise.resolve()
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', (event) =>
      reject(event.error instanceof Error ? event.error : new Error('CDP socket failed.')),
    )
  })
}

function parseMessage(data: unknown): CdpInbound | null {
  if (typeof data !== 'string') return null
  try { return JSON.parse(data) as CdpInbound } catch { return null }
}

function getGlobalWebSocket(): WebSocketConstructor {
  const ctor = (globalThis as unknown as { WebSocket?: WebSocketConstructor }).WebSocket
  if (!ctor) throw new Error('This Node.js runtime does not provide WebSocket.')
  return ctor
}
