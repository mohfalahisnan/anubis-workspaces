import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createChatGPTCdpCaptureService } from '../src/core/services/chatgpt-cdp-capture.service.js'
import type { CdpSession } from '../src/core/chrome/cdp-session.js'
import { fakeGetManager } from './browser/fake-browser.js'

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

const DETAIL_BODY = {
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
}

// captureDetails now reads via a page-context fetch (Runtime.evaluate), not network sniffing.
function mockDetailsSession(listeners: Record<string, (params: unknown) => void>): CdpSession {
  return {
    async send(method: string, params: any) {
      if (method === 'Runtime.evaluate') {
        const expr = String(params?.expression || '')
        if (expr.includes('document.readyState')) {
          return { result: { value: { href: 'https://chatgpt.com/c/chat-1', ready: 'complete' } } } as never
        }
        if (expr.includes('/backend-api/conversation/')) {
          return { result: { value: { status: 200, body: JSON.stringify(DETAIL_BODY) } } } as never
        }
        return { result: { value: undefined } } as never
      }
      return {} as never
    },
    on(event: string, callback: (params: unknown) => void) {
      listeners[event] = callback
    },
    close() {}
  }
}

const PROMPT_BODY = {
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
}

function mockPromptSession(listeners: Record<string, (params: unknown) => void>): CdpSession {
  return {
    async send(method: string, params: any) {
      if (method === 'Page.enable' || method === 'Page.navigate' || method === 'Input.insertText') {
        return {} as never
      }
      if (method === 'Runtime.evaluate') {
        const expr = String(params?.expression || '')
        if (expr.includes('document.readyState')) {
          return { result: { value: { href: 'https://chatgpt.com/', ready: 'complete' } } } as never
        }
        // streaming read: { count, text } of the rendered assistant turns (new chat → 1)
        if (expr.includes('data-message-author-role') && expr.includes('innerText')) {
          return { result: { value: { count: 1, text: 'I am doing great!' } } } as never
        }
        // count-only queries (render wait / pre-send snapshot)
        if (expr.includes('data-message-author-role')) {
          return { result: { value: 0 } } as never
        }
        // generation finished -> stop button absent
        if (expr.includes('stop-button') || expr.includes('Stop generating')) {
          return { result: { value: false } } as never
        }
        // post-send: read updated conversation detail via page fetch
        if (expr.includes('/backend-api/conversation/')) {
          return { result: { value: { status: 200, body: JSON.stringify(PROMPT_BODY) } } } as never
        }
        if (expr.includes('window.location.href')) {
          return { result: { value: 'https://chatgpt.com/c/new-chat-uuid' } } as never
        }
        return { result: { value: true } } as never
      }
      return {} as never
    },
    on(event: string, callback: (params: unknown) => void) {
      listeners[event] = callback
    },
    close() {}
  }
}

test('ChatGPT capture service successfully gets conversation list', async () => {
  const listeners: Record<string, (params: unknown) => void> = {}
  const service = createChatGPTCdpCaptureService({ getManager: fakeGetManager(mockSession(listeners)) })

  const result = await service.capture({
    url: 'https://chatgpt.com/',
    openNewTab: true,
    keepTabOpen: false,
    timeoutMs: 1000,
    initialDelayMs: 0
  })

  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.conversations.length, 1)
    assert.equal(result.conversations[0].id, 'chat-1')
    assert.equal(result.conversations[0].title, 'Hello ChatGPT')
  }
})

test('ChatGPT capture service successfully gets conversation details', async () => {
  const listeners: Record<string, (params: unknown) => void> = {}
  const service = createChatGPTCdpCaptureService({ getManager: fakeGetManager(mockDetailsSession(listeners)) })

  const result = await service.captureDetails({
    conversationId: 'chat-1',
    openNewTab: true,
    keepTabOpen: false,
    timeoutMs: 1000
  })

  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.messages.length, 2)
    assert.equal(result.messages[0].role, 'user')
    assert.equal(result.messages[0].content, 'Hello')
    assert.equal(result.messages[1].role, 'assistant')
    assert.equal(result.messages[1].content, 'Hi there!')
  }
  // Debug diagnostics are collected for the playground.
  assert.ok(result.debug, 'expected debug collector on result')
  assert.ok(result.debug.events.length > 0, 'expected debug events')
  assert.ok(
    result.debug.responses.some((r) => r.url.includes('/backend-api/conversation/chat-1') && r.matched),
    'expected the conversation response to be recorded as observed+matched'
  )
})

test('ChatGPT capture service successfully sends a prompt', async () => {
  const listeners: Record<string, (params: unknown) => void> = {}
  const service = createChatGPTCdpCaptureService({ getManager: fakeGetManager(mockPromptSession(listeners)) })

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
  // Streaming: onDelta receives the assistant text rendered in the DOM.
  assert.ok(deltas.length > 0, 'expected at least one streamed delta')
  assert.equal(deltas[deltas.length - 1], 'I am doing great!')
})
