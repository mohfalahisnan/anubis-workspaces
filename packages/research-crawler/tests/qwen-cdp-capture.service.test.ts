import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createQwenCdpCaptureService } from '../src/core/services/qwen-cdp-capture.service.js'
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

const newTabTarget = { id: 'NT', type: 'page', url: 'https://chat.qwen.ai/', webSocketDebuggerUrl: 'ws://nt' }

// Qwen's real list shape: { success, request_id, data: ChatSummary[] }.
const QWEN_LIST = {
  success: true,
  request_id: 'req-1',
  data: [
    { id: 'chat-1', title: 'Hello Qwen', created_at: 1715000000, updated_at: 1715000100 }
  ]
}

// Qwen's real detail shape: data.chat.history.{messages map, currentId}. Assistant
// text lives in content_list[] blocks whose phase === 'answer'.
const QWEN_DETAIL = {
  data: {
    chat: {
      history: {
        currentId: 'a2',
        messages: {
          u1: { id: 'u1', role: 'user', content: 'Hello', parentId: null, childrenIds: ['a2'], timestamp: 1715000000 },
          a2: {
            id: 'a2', role: 'assistant', content: '', parentId: 'u1', childrenIds: [], timestamp: 1715000100,
            content_list: [
              { phase: 'thinking_summary', content: '' },
              { phase: 'answer', content: 'Hi there!' }
            ]
          }
        }
      }
    }
  }
}

const QWEN_PROMPT_DETAIL = {
  data: {
    chat: {
      history: {
        currentId: 'a2',
        messages: {
          u1: { id: 'u1', role: 'user', content: 'How are you?', parentId: null, childrenIds: ['a2'], timestamp: 1715000000 },
          a2: {
            id: 'a2', role: 'assistant', content: '', parentId: 'u1', childrenIds: [], timestamp: 1715000100,
            content_list: [{ phase: 'answer', content: 'I am doing great!' }]
          }
        }
      }
    }
  }
}

function evalValue(value: unknown) {
  return { result: { value } } as never
}

function mockListSession(listeners: Record<string, (params: unknown) => void>): CdpSession {
  return {
    async send(method: string, params: any) {
      if (method !== 'Runtime.evaluate') return {} as never
      const expr = String(params?.expression || '')
      if (expr.includes('/api/v1/auths/')) return evalValue(200)
      if (expr.includes('document.readyState')) return evalValue({ href: 'https://chat.qwen.ai/', ready: 'complete' })
      if (expr.includes('/api/v2/chats/')) return evalValue({ status: 200, body: JSON.stringify(QWEN_LIST) })
      return evalValue(true)
    },
    on(event, callback) { listeners[event] = callback },
    close() {}
  }
}

function mockDetailsSession(listeners: Record<string, (params: unknown) => void>): CdpSession {
  return {
    async send(method: string, params: any) {
      if (method !== 'Runtime.evaluate') return {} as never
      const expr = String(params?.expression || '')
      if (expr.includes('/api/v1/auths/')) return evalValue(200)
      if (expr.includes('document.readyState')) return evalValue({ href: 'https://chat.qwen.ai/c/chat-1', ready: 'complete' })
      if (expr.includes('/api/v2/chats/')) return evalValue({ status: 200, body: JSON.stringify(QWEN_DETAIL) })
      return evalValue(true)
    },
    on(event, callback) { listeners[event] = callback },
    close() {}
  }
}

function mockPromptSession(listeners: Record<string, (params: unknown) => void>): CdpSession {
  return {
    async send(method: string, params: any) {
      if (method === 'Page.enable' || method === 'Page.navigate' || method === 'Input.insertText') return {} as never
      if (method !== 'Runtime.evaluate') return {} as never
      const expr = String(params?.expression || '')
      if (expr.includes('/api/v1/auths/')) return evalValue(200)
      if (expr.includes('document.readyState')) return evalValue({ href: 'https://chat.qwen.ai/', ready: 'complete' })
      // composer existence wait: `!!document.querySelector('textarea...')`
      if (expr.startsWith('!!') && expr.includes('querySelector')) return evalValue(true)
      // composer empty check
      if (expr.includes("'value' in ta")) return evalValue(false)
      // streaming snapshot: { count, answerText, fullText }
      if (expr.includes('qwen-chat-message-assistant') && expr.includes('count')) {
        return evalValue({ count: 1, answerText: 'I am doing great!', fullText: 'I am doing great!' })
      }
      // stop button (generation finished)
      if (expr.includes('stop-button')) return evalValue(false)
      // url after submit -> a new chat id (not 'new-chat'/'guest')
      if (expr.includes('window.location.href')) return evalValue('https://chat.qwen.ai/c/new-chat-uuid')
      // canonical detail fetch
      if (expr.includes('/api/v2/chats/')) return evalValue({ status: 200, body: JSON.stringify(QWEN_PROMPT_DETAIL) })
      return evalValue(true)
    },
    on(event, callback) { listeners[event] = callback },
    close() {}
  }
}

test('Qwen capture service successfully gets conversation list', async () => {
  const { impl, calls } = mockFetch({
    '/json/new': () => jsonResponse(true, 200, newTabTarget),
    '/json/close': () => jsonResponse(true, 200, {})
  })
  const listeners: Record<string, (params: unknown) => void> = {}
  const service = createQwenCdpCaptureService({ fetchImpl: impl, connectSession: async () => mockListSession(listeners) })

  const result = await service.capture({ openNewTab: true, keepTabOpen: false, timeoutMs: 1000 })

  assert.equal(result.ok, true)
  assert.ok(calls.includes('PUT /json/new'))
  assert.ok(calls.includes('GET /json/close'))
  if (result.ok) {
    assert.equal(result.conversations.length, 1)
    assert.equal(result.conversations[0].id, 'chat-1')
    assert.equal(result.conversations[0].title, 'Hello Qwen')
  }
})

test('Qwen capture service successfully gets conversation details', async () => {
  const { impl, calls } = mockFetch({
    '/json/new': () => jsonResponse(true, 200, newTabTarget),
    '/json/close': () => jsonResponse(true, 200, {})
  })
  const listeners: Record<string, (params: unknown) => void> = {}
  const service = createQwenCdpCaptureService({ fetchImpl: impl, connectSession: async () => mockDetailsSession(listeners) })

  const result = await service.captureDetails({ conversationId: 'chat-1', openNewTab: true, keepTabOpen: false, timeoutMs: 1000 })

  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.messages.length, 2)
    assert.equal(result.messages[0].role, 'user')
    assert.equal(result.messages[0].content, 'Hello')
    assert.equal(result.messages[1].role, 'assistant')
    // content pulled from the phase:"answer" block, not the empty top-level content.
    assert.equal(result.messages[1].content, 'Hi there!')
  }
  assert.ok(result.debug && result.debug.events.length > 0, 'expected debug events')
  assert.ok(
    result.debug!.responses.some((r) => r.url.includes('/api/v2/chats/chat-1') && r.matched),
    'expected the conversation response to be recorded as observed+matched'
  )
})

test('Qwen capture service successfully sends a prompt', async () => {
  const { impl, calls } = mockFetch({
    '/json/new': () => jsonResponse(true, 200, newTabTarget),
    '/json/close': () => jsonResponse(true, 200, {})
  })
  const listeners: Record<string, (params: unknown) => void> = {}
  const service = createQwenCdpCaptureService({ fetchImpl: impl, connectSession: async () => mockPromptSession(listeners) })

  const deltas: string[] = []
  const result = await service.sendPrompt({
    prompt: 'How are you?',
    openNewTab: true,
    keepTabOpen: false,
    timeoutMs: 1000,
    onDelta: (text) => deltas.push(text)
  })

  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.conversationId, 'new-chat-uuid')
    assert.equal(result.messages.length, 2)
    assert.equal(result.messages[0].content, 'How are you?')
    assert.equal(result.messages[1].content, 'I am doing great!')
  }
  assert.ok(deltas.length > 0, 'expected at least one streamed delta')
  assert.equal(deltas[deltas.length - 1], 'I am doing great!')
})

test('Qwen capture service reports not-logged-in', async () => {
  const { impl } = mockFetch({
    '/json/new': () => jsonResponse(true, 200, newTabTarget),
    '/json/close': () => jsonResponse(true, 200, {})
  })
  const listeners: Record<string, (params: unknown) => void> = {}
  const session: CdpSession = {
    async send(method: string, params: any) {
      if (method !== 'Runtime.evaluate') return {} as never
      const expr = String(params?.expression || '')
      if (expr.includes('/api/v1/auths/')) return evalValue(401)
      if (expr.includes('document.readyState')) return evalValue({ href: 'https://chat.qwen.ai/', ready: 'complete' })
      return evalValue(true)
    },
    on(event, callback) { listeners[event] = callback },
    close() {}
  }
  const service = createQwenCdpCaptureService({ fetchImpl: impl, connectSession: async () => session })
  const result = await service.capture({ openNewTab: true, keepTabOpen: false, timeoutMs: 1000 })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error.message, /Not logged in/i)
})
