import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createChatGPTCdpCaptureService } from '../src/core/services/chatgpt-cdp-capture.service.js'
import type { CdpSession } from '../src/core/chrome/cdp-session.js'

function jsonResponse(ok: boolean, status: number, body: unknown) {
  return { ok, status, json: async () => body }
}

function mockFetch(routes: Record<string, () => unknown>): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const impl = (async (input: unknown, init?: { method?: string }) => {
    const url = new URL(String(input))
    const key = url.pathname.startsWith('/json/close') ? '/json/close' : url.pathname
    calls.push(`${init?.method ?? 'GET'} ${key}`)
    const handler = routes[key]
    if (!handler) throw new Error(`unexpected fetch ${key}`)
    return handler() as unknown as Response
  }) as unknown as typeof fetch
  return { impl, calls }
}

function mockSession(listeners: Record<string, (params: unknown) => void>): CdpSession {
  return {
    async send(method: string) {
      if (method === 'Network.enable') {
        setTimeout(() => {
          listeners['Network.responseReceived']?.({
            requestId: '123',
            response: {
              url: 'https://chatgpt.com/backend-api/conversations?offset=0&limit=28',
              status: 200,
              mimeType: 'application/json',
              headers: { 'content-type': 'application/json' }
            }
          })
          listeners['Network.loadingFinished']?.({
            requestId: '123'
          })
        }, 10)
        return {} as never
      }
      if (method === 'Page.enable' || method === 'Page.navigate') {
        return {} as never
      }
      if (method === 'Network.getResponseBody') {
        return {
          body: JSON.stringify({
            items: [
              {
                id: 'chat-1',
                title: 'Hello ChatGPT',
                create_time: 1715000000,
                update_time: 1715000100
              }
            ],
            total: 1,
            limit: 28,
            offset: 0,
            has_more: false
          }),
          base64Encoded: false
        } as never
      }
      return {} as never
    },
    on(event: string, callback: (params: unknown) => void) {
      listeners[event] = callback
    },
    close() {}
  }
}

function mockDetailsSession(listeners: Record<string, (params: unknown) => void>): CdpSession {
  return {
    async send(method: string, params: any) {
      if (method === 'Network.enable') {
        setTimeout(() => {
          listeners['Network.responseReceived']?.({
            requestId: '123',
            response: {
              url: 'https://chatgpt.com/backend-api/conversation/chat-1',
              status: 200,
              mimeType: 'application/json',
              headers: { 'content-type': 'application/json' }
            }
          })
          listeners['Network.loadingFinished']?.({
            requestId: '123'
          })
        }, 10)
        return {} as never
      }
      if (method === 'Page.enable' || method === 'Page.navigate') {
        return {} as never
      }
      if (method === 'Network.getResponseBody') {
        return {
          body: JSON.stringify({
            title: 'Hello ChatGPT Details',
            create_time: 1715000000,
            current_node: 'node-2',
            mapping: {
              'node-1': {
                id: 'node-1',
                message: {
                  id: 'msg-1',
                  author: { role: 'user' },
                  content: { content_type: 'text', parts: ['Hello'] },
                  create_time: 1715000000
                },
                parent: null,
                children: ['node-2']
              },
              'node-2': {
                id: 'node-2',
                message: {
                  id: 'msg-2',
                  author: { role: 'assistant' },
                  content: { content_type: 'text', parts: ['Hi there!'] },
                  create_time: 1715000100
                },
                parent: 'node-1',
                children: []
              }
            }
          }),
          base64Encoded: false
        } as never
      }
      return {} as never
    },
    on(event: string, callback: (params: unknown) => void) {
      listeners[event] = callback
    },
    close() {}
  }
}

function mockPromptSession(listeners: Record<string, (params: unknown) => void>): CdpSession {
  return {
    async send(method: string, params: any) {
      if (method === 'Network.enable') {
        setTimeout(() => {
          listeners['Network.responseReceived']?.({
            requestId: '123',
            response: {
              url: 'https://chatgpt.com/backend-api/conversation/new-chat-uuid',
              status: 200,
              mimeType: 'application/json',
              headers: { 'content-type': 'application/json' }
            }
          })
          listeners['Network.loadingFinished']?.({
            requestId: '123'
          })
        }, 20)
        return {} as never
      }
      if (method === 'Page.enable' || method === 'Page.navigate') {
        return {} as never
      }
      if (method === 'Runtime.evaluate') {
        const expr = params?.expression || ''
        if (expr.includes('stop-button') || expr.includes('Stop generating')) {
          return { result: { value: 'idle' } } as never
        }
        if (expr.includes('window.location.href')) {
          return { result: { value: 'https://chatgpt.com/c/new-chat-uuid' } } as never
        }
        return { result: { value: true } } as never
      }
      if (method === 'Input.insertText') {
        return {} as never
      }
      if (method === 'Network.getResponseBody') {
        return {
          body: JSON.stringify({
            title: 'Mock New Chat',
            create_time: 1715000000,
            current_node: 'node-2',
            mapping: {
              'node-1': {
                id: 'node-1',
                message: {
                  id: 'msg-1',
                  author: { role: 'user' },
                  content: { content_type: 'text', parts: ['How are you?'] },
                  create_time: 1715000000
                },
                parent: null,
                children: ['node-2']
              },
              'node-2': {
                id: 'node-2',
                message: {
                  id: 'msg-2',
                  author: { role: 'assistant' },
                  content: { content_type: 'text', parts: ['I am doing great!'] },
                  create_time: 1715000100
                },
                parent: 'node-1',
                children: []
              }
            }
          }),
          base64Encoded: false
        } as never
      }
      return {} as never
    },
    on(event: string, callback: (params: unknown) => void) {
      listeners[event] = callback
    },
    close() {}
  }
}

const newTabTarget = { id: 'NT', type: 'page', url: 'https://chatgpt.com/', webSocketDebuggerUrl: 'ws://nt' }

test('ChatGPT capture service successfully gets conversation list', async () => {
  const { impl, calls } = mockFetch({
    '/json/new': () => jsonResponse(true, 200, newTabTarget),
    '/json/close': () => jsonResponse(true, 200, {})
  })
  const listeners: Record<string, (params: unknown) => void> = {}
  const service = createChatGPTCdpCaptureService({
    fetchImpl: impl,
    connectSession: async () => mockSession(listeners)
  })

  const result = await service.capture({
    url: 'https://chatgpt.com/',
    openNewTab: true,
    keepTabOpen: false,
    timeoutMs: 1000,
    initialDelayMs: 0
  })

  assert.equal(result.ok, true)
  assert.ok(calls.includes('PUT /json/new'))
  assert.ok(calls.includes('GET /json/close'))
  if (result.ok) {
    assert.equal(result.conversations.length, 1)
    assert.equal(result.conversations[0].id, 'chat-1')
    assert.equal(result.conversations[0].title, 'Hello ChatGPT')
  }
})

test('ChatGPT capture service successfully gets conversation details', async () => {
  const { impl, calls } = mockFetch({
    '/json/new': () => jsonResponse(true, 200, newTabTarget),
    '/json/close': () => jsonResponse(true, 200, {})
  })
  const listeners: Record<string, (params: unknown) => void> = {}
  const service = createChatGPTCdpCaptureService({
    fetchImpl: impl,
    connectSession: async () => mockDetailsSession(listeners)
  })

  const result = await service.captureDetails({
    conversationId: 'chat-1',
    openNewTab: true,
    keepTabOpen: false,
    timeoutMs: 1000
  })

  assert.equal(result.ok, true)
  assert.ok(calls.includes('PUT /json/new'))
  assert.ok(calls.includes('GET /json/close'))
  if (result.ok) {
    assert.equal(result.messages.length, 2)
    assert.equal(result.messages[0].role, 'user')
    assert.equal(result.messages[0].content, 'Hello')
    assert.equal(result.messages[1].role, 'assistant')
    assert.equal(result.messages[1].content, 'Hi there!')
  }
})

test('ChatGPT capture service successfully sends a prompt', async () => {
  const { impl, calls } = mockFetch({
    '/json/new': () => jsonResponse(true, 200, newTabTarget),
    '/json/close': () => jsonResponse(true, 200, {})
  })
  const listeners: Record<string, (params: unknown) => void> = {}
  const service = createChatGPTCdpCaptureService({
    fetchImpl: impl,
    connectSession: async () => mockPromptSession(listeners)
  })

  const result = await service.sendPrompt({
    prompt: 'How are you?',
    openNewTab: true,
    keepTabOpen: false,
    timeoutMs: 1000
  })

  assert.equal(result.ok, true)
  assert.ok(calls.includes('PUT /json/new'))
  assert.ok(calls.includes('GET /json/close'))
  if (result.ok) {
    assert.equal(result.conversationId, 'new-chat-uuid')
    assert.equal(result.messages.length, 2)
    assert.equal(result.messages[0].content, 'How are you?')
    assert.equal(result.messages[1].content, 'I am doing great!')
  }
})
