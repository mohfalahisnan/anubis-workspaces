import { createServer, type Server as HttpServer } from 'node:http'
import { WebSocketServer, type WebSocket as WS } from 'ws'
import { ExtensionToBackend, type HelloFrame } from './schemas.js'

export interface WSServerOpts {
  secret: string
  backendVersion: string
  /** Inclusive [low, high]. Server tries each in order until bind succeeds. */
  portRange: [number, number]
  /** Override for tests. Defaults to 25_000 (25s). */
  pingIntervalMs?: number
}

interface ActiveClient {
  ws: WS
  extensionVersion: string
  pairedAt: number
  pingTimer: NodeJS.Timeout
}

/* -----------------------------------------------------------
   WSServer
   -----------------------------------------------------------
   Single-client WebSocket server for the Anubis ↔ extension
   wire. Lifecycle:
     1. start()  → binds an HTTP server on the first free port
                   in portRange, attaches a WebSocketServer to
                   the `/ext` upgrade path. Returns the bound
                   port.
     2. client connects, sends a `hello`. If secret matches we
        send `welcome` and route subsequent frames through
        onFrame. If not, close with 4401.
     3. A second valid `hello` evicts the first (close 4409).
     4. stop()  → closes the current client, then the HTTP
                  server.
   ----------------------------------------------------------- */

export class WSServer {
  private http: HttpServer | null = null
  private wss: WebSocketServer | null = null
  private active: ActiveClient | null = null
  private readonly pingIntervalMs: number

  /** Called once per validated inbound frame (after handshake). */
  onFrame: ((frame: unknown) => void) | null = null
  /** Called when a client paired. */
  onConnect: ((info: { version: string; pairedAt: number }) => void) | null = null
  /** Called when the active client goes away (any reason). */
  onDisconnect: (() => void) | null = null

  constructor(private readonly opts: WSServerOpts) {
    this.pingIntervalMs = opts.pingIntervalMs ?? 25_000
  }

  async start(): Promise<number> {
    const [lo, hi] = this.opts.portRange
    for (let port = lo; port <= hi; port++) {
      try {
        const bound = await this.tryBind(port)
        return bound
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e
      }
    }
    throw new Error(`No free port in ${lo}-${hi} for the extension WS server.`)
  }

  private tryBind(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const http = createServer()
      const wss = new WebSocketServer({ noServer: true })
      wss.on('connection', (ws) => this.onConnection(ws))

      const onError = (err: Error) => {
        http.removeListener('error', onError)
        http.removeListener('listening', onListening)
        try { wss.close() } catch { /* ignore */ }
        try { http.close() } catch { /* ignore */ }
        reject(err)
      }
      const onListening = () => {
        http.removeListener('error', onError)
        http.removeListener('listening', onListening)
        http.on('upgrade', (request, socket, head) => {
          if (request.url === '/ext') {
            wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws))
          } else {
            socket.destroy()
          }
        })
        this.http = http
        this.wss = wss
        resolve(port)
      }
      http.once('error', onError)
      http.once('listening', onListening)
      http.listen(port, '127.0.0.1')
    })
  }

  async stop(): Promise<void> {
    if (this.active) {
      clearInterval(this.active.pingTimer)
      this.active.ws.close(1000, 'shutdown')
      this.active = null
    }
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve()
      this.wss.close(() => resolve())
    })
    await new Promise<void>((resolve) => {
      if (!this.http) return resolve()
      this.http.close(() => resolve())
    })
    this.http = null
    this.wss = null
  }

  isConnected(): boolean {
    return this.active !== null
  }
  connectedExtensionVersion(): string | undefined {
    return this.active?.extensionVersion
  }
  pairedAt(): number | undefined {
    return this.active?.pairedAt
  }

  /** Sends a frame to the active client. Returns false if none. */
  send(frame: unknown): boolean {
    if (!this.active) return false
    this.active.ws.send(JSON.stringify(frame))
    return true
  }

  forceDisconnect(reason: string): void {
    if (!this.active) return
    clearInterval(this.active.pingTimer)
    this.active.ws.close(4410, reason)
    this.active = null
    this.onDisconnect?.()
  }

  private onConnection(ws: WS): void {
    let handshaken = false

    ws.on('message', (raw) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (!handshaken) {
        const hello = HelloFrame_safeParse(parsed)
        if (!hello.ok || hello.data.secret !== this.opts.secret) {
          ws.close(4401, 'unauthorized')
          return
        }
        handshaken = true
        this.promote(ws, hello.data.version)
        return
      }
      const validated = ExtensionToBackend.safeParse(parsed)
      if (!validated.success) return
      this.onFrame?.(validated.data)
    })

    ws.on('close', () => {
      if (this.active?.ws === ws) {
        clearInterval(this.active.pingTimer)
        this.active = null
        this.onDisconnect?.()
      }
    })
  }

  private promote(ws: WS, version: string): void {
    if (this.active) {
      clearInterval(this.active.pingTimer)
      this.active.ws.close(4409, 'replaced')
      this.active = null
      this.onDisconnect?.()
    }
    const pingTimer = setInterval(() => {
      try { ws.ping() } catch { /* swallow */ }
    }, this.pingIntervalMs)
    this.active = { ws, extensionVersion: version, pairedAt: Date.now(), pingTimer }
    ws.send(JSON.stringify({ type: 'welcome', backendVersion: this.opts.backendVersion }))
    this.onConnect?.({ version, pairedAt: this.active.pairedAt })
  }
}

function HelloFrame_safeParse(value: unknown):
  | { ok: true; data: HelloFrame }
  | { ok: false } {
  const r = ExtensionToBackend.safeParse(value)
  if (r.success && r.data.type === 'hello') return { ok: true, data: r.data }
  return { ok: false }
}
