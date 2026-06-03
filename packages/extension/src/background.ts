import {
  PORT_RANGE,
  type BackendFrame,
  type DispatchFrame,
  type ErrorFrame,
  type HelloFrame,
  type ResultFrame,
} from './wire.js'

const EXT_VERSION = chrome.runtime.getManifest().version
const STORAGE_KEYS = {
  secret: 'anubis.secret',
  lastPort: 'anubis.lastPort',
} as const

interface State {
  ws: WebSocket | null
  port: number | null
  reconnectAttempt: number
  jobsByTab: Map<number, string>
  jobsByJob: Map<string, number>
}
const state: State = { ws: null, port: null, reconnectAttempt: 0, jobsByTab: new Map(), jobsByJob: new Map() }

/* Keepalive — MV3 service workers idle after ~30s. */
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 })
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'keepalive') void ensureConnected()
})
self.addEventListener('activate', () => void ensureConnected())

/* Tab cleanup — if the hidden tab closes mid-job, reject. */
chrome.tabs.onRemoved.addListener((tabId) => {
  const jobId = state.jobsByTab.get(tabId)
  if (!jobId) return
  state.jobsByTab.delete(tabId)
  state.jobsByJob.delete(jobId)
  sendFrame<ErrorFrame>({ type: 'error', jobId, ok: false, code: 'TAB_CLOSED', message: 'Hidden tab closed before completion.' })
})

/* Connection management */
async function ensureConnected(): Promise<void> {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) return
  if (state.ws && state.ws.readyState === WebSocket.CONNECTING) return

  const secret = await getSecret()
  if (!secret) return  // user hasn't paired yet

  const orderedPorts = await orderedCandidatePorts()
  for (const port of orderedPorts) {
    const ok = await tryConnect(port, secret)
    if (ok) {
      state.port = port
      state.reconnectAttempt = 0
      await chrome.storage.local.set({ [STORAGE_KEYS.lastPort]: port })
      return
    }
  }
  state.reconnectAttempt = Math.min(state.reconnectAttempt + 1, 8)
  const delay = Math.min(30_000, 1000 * 2 ** state.reconnectAttempt) + Math.random() * 500
  setTimeout(() => void ensureConnected(), delay)
}

async function orderedCandidatePorts(): Promise<number[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.lastPort)
  const last = typeof stored[STORAGE_KEYS.lastPort] === 'number' ? stored[STORAGE_KEYS.lastPort] as number : null
  if (!last) return PORT_RANGE.slice()
  return [last, ...PORT_RANGE.filter((p) => p !== last)]
}

function tryConnect(port: number, secret: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ext`)
    let settled = false
    const settle = (ok: boolean) => { if (!settled) { settled = true; resolve(ok) } }
    ws.onopen = () => {
      const hello: HelloFrame = { type: 'hello', secret, version: EXT_VERSION }
      ws.send(JSON.stringify(hello))
    }
    ws.onmessage = (evt) => {
      let frame: BackendFrame
      try { frame = JSON.parse(evt.data as string) as BackendFrame } catch { return }
      if (frame.type === 'welcome') {
        state.ws = ws
        ws.onmessage = handleFrame
        ws.onclose = () => onClose()
        settle(true)
        return
      }
    }
    ws.onclose = () => settle(false)
    ws.onerror = () => settle(false)
    setTimeout(() => { if (!settled) { try { ws.close() } catch {} settle(false) } }, 2000)
  })
}

function onClose(): void {
  state.ws = null
  setTimeout(() => void ensureConnected(), 1000)
}

function handleFrame(evt: MessageEvent): void {
  let frame: BackendFrame
  try { frame = JSON.parse(evt.data as string) as BackendFrame } catch { return }
  if (frame.type === 'dispatch') void runJob(frame)
  else if (frame.type === 'cancel') cancelJob(frame.jobId)
}

/* Job execution: open a minimised popup window for the IG URL, content
   script does the actual scraping and posts results back via runtime
   messaging. */
async function runJob(dispatch: DispatchFrame): Promise<void> {
  const url = targetUrlForJob(dispatch)
  if (!url) {
    sendFrame<ErrorFrame>({ type: 'error', jobId: dispatch.jobId, ok: false, code: 'BAD_INPUT', message: 'unrecognised job kind' })
    return
  }
  const win = await chrome.windows.create({ url, type: 'popup', state: 'minimized', focused: false, width: 800, height: 600 })
  const tabId = win.tabs?.[0]?.id
  if (!tabId) {
    sendFrame<ErrorFrame>({ type: 'error', jobId: dispatch.jobId, ok: false, code: 'TAB_OPEN_FAILED', message: 'Failed to open hidden tab' })
    return
  }
  state.jobsByTab.set(tabId, dispatch.jobId)
  state.jobsByJob.set(dispatch.jobId, tabId)

  const listener = (msg: unknown, sender: chrome.runtime.MessageSender) => {
    if (sender.tab?.id !== tabId) return
    const m = msg as { type?: string; jobId?: string; data?: unknown; code?: string; message?: string }
    if (m.type === 'ready') {
      chrome.tabs.sendMessage(tabId, { type: 'execute', jobId: dispatch.jobId, kind: dispatch.kind, input: dispatch.input })
    } else if (m.type === 'result' && m.jobId === dispatch.jobId) {
      sendFrame<ResultFrame>({ type: 'result', jobId: dispatch.jobId, ok: true, data: m.data })
      finishJob(dispatch.jobId)
    } else if (m.type === 'error' && m.jobId === dispatch.jobId) {
      sendFrame<ErrorFrame>({ type: 'error', jobId: dispatch.jobId, ok: false, code: m.code ?? 'CONTENT_ERROR', message: m.message ?? 'content script reported error' })
      finishJob(dispatch.jobId)
    }
  }
  chrome.runtime.onMessage.addListener(listener)

  setTimeout(() => {
    if (state.jobsByJob.has(dispatch.jobId)) {
      chrome.runtime.onMessage.removeListener(listener)
      finishJob(dispatch.jobId)
    }
  }, dispatch.timeoutMs + 5_000)
}

function finishJob(jobId: string): void {
  const tabId = state.jobsByJob.get(jobId)
  if (tabId === undefined) return
  state.jobsByJob.delete(jobId)
  state.jobsByTab.delete(tabId)
  chrome.tabs.remove(tabId).catch(() => { /* already closed */ })
}

function cancelJob(jobId: string): void {
  finishJob(jobId)
}

function targetUrlForJob(dispatch: DispatchFrame): string | null {
  if (dispatch.kind === 'capture-profile') {
    const input = dispatch.input as { username?: string }
    if (!input.username) return null
    return `https://www.instagram.com/${encodeURIComponent(input.username)}/`
  }
  if (dispatch.kind === 'discover') {
    const input = dispatch.input as { source?: string; hashtag?: string; keyword?: string }
    if (input.source === 'hashtag' && input.hashtag) return `https://www.instagram.com/explore/tags/${encodeURIComponent(input.hashtag)}/`
    if (input.source === 'keyword') return `https://www.instagram.com/`
    return `https://www.instagram.com/explore/`
  }
  return null
}

function sendFrame<T>(frame: T): void {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return
  state.ws.send(JSON.stringify(frame))
}

async function getSecret(): Promise<string | null> {
  const out = await chrome.storage.local.get(STORAGE_KEYS.secret)
  const v = out[STORAGE_KEYS.secret]
  return typeof v === 'string' && v.length >= 32 ? v : null
}

void ensureConnected()

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return
  const m = msg as { type?: string; secret?: string }
  if (m.type === 'secret-updated' && typeof m.secret === 'string') {
    if (state.ws) try { state.ws.close() } catch {}
    state.ws = null
    void chrome.storage.local.set({ [STORAGE_KEYS.secret]: m.secret }).then(() => ensureConnected())
    sendResponse({ ok: true })
    return true
  }
  if (m.type === 'status?') {
    sendResponse({
      connected: !!state.ws && state.ws.readyState === WebSocket.OPEN,
      port: state.port,
      version: EXT_VERSION,
    })
    return true
  }
  return
})
