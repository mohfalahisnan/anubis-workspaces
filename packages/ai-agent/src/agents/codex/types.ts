export interface RpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: unknown
}

export interface RpcResponse {
  jsonrpc: '2.0'
  id: number | string
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export interface RpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export type RpcMessage = RpcRequest | RpcResponse | RpcNotification
