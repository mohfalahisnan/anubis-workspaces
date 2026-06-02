import type { Readable, Writable } from 'node:stream'
import split2 from 'split2'
import type {
  RpcMessage,
  RpcRequest,
  RpcResponse,
  RpcNotification,
} from './types.js'

export class JsonRpcClient {
  private nextId = 1
  private pending = new Map<
    number | string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >()

  onNotification: ((n: RpcNotification) => void) | undefined
  onRequest: ((r: RpcRequest) => void) | undefined

  constructor(
    private incoming: Readable,
    private outgoing: Writable,
  ) {
    this.incoming.pipe(split2()).on('data', (line: string) => this.handle(line))
  }

  private handle(line: string): void {
    if (!line.trim()) return

    let msg: RpcMessage
    try {
      msg = JSON.parse(line) as RpcMessage
    } catch {
      return
    }

    const hasId = 'id' in msg
    const hasMethod = 'method' in msg

    if (hasId && hasMethod) {
      const req = msg as RpcRequest
      if (this.onRequest) {
        this.onRequest(req)
      } else {
        this.respondError(req.id, -32601, `Method not found: ${req.method}`)
      }
      return
    }

    if (hasId) {
      const res = msg as RpcResponse
      const slot = this.pending.get(res.id)
      if (!slot) return
      this.pending.delete(res.id)
      if (res.error) {
        slot.reject(new Error(`${res.error.code}: ${res.error.message}`))
      } else {
        slot.resolve(res.result)
      }
      return
    }

    this.onNotification?.(msg as RpcNotification)
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++
    const req: RpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    }

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.outgoing.write(`${JSON.stringify(req)}\n`, (err) => {
        if (err) {
          this.pending.delete(id)
          reject(err)
        }
      })
    })
  }

  notify(method: string, params?: unknown): void {
    const n: RpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {}),
    }
    this.outgoing.write(`${JSON.stringify(n)}\n`)
  }

  respond(id: number | string, result: unknown): void {
    const r: RpcResponse = { jsonrpc: '2.0', id, result }
    this.outgoing.write(`${JSON.stringify(r)}\n`)
  }

  respondError(id: number | string, code: number, message: string, data?: unknown): void {
    const r: RpcResponse = {
      jsonrpc: '2.0',
      id,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    }
    this.outgoing.write(`${JSON.stringify(r)}\n`)
  }
}
