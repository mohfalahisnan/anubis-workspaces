// Discovery harness: drive the real Qwen login-profile Chrome over CDP and learn
// (a) how it authenticates, (b) how it lists conversations, (c) how it reads a
// conversation's detail, and (d) what the send-message request + DOM look like.
// Resolves the SAME login profile the playground UI uses.
//
// Per docs/chatgpt-crawler-cdp.md §4: we do NOT assume Qwen's shapes — we observe
// the real network + DOM and print a report. Use it to drive the implementation.
//
// Usage (from repo root, after `pnpm --filter @anubis/research-crawler build`):
//   node scripts/discover-qwen-api.mjs                       # auth + list + detail shapes
//   SEND_PROMPT="hi there" node scripts/discover-qwen-api.mjs  # also send a prompt and capture the POST + DOM
//
// It waits (polls) up to ~4 min for you to log in to chat.qwen.ai in the window it opens.

import { homedir, tmpdir } from 'node:os'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { launchChrome } from '../packages/research-crawler/dist/core/chrome/launch-chrome.js'
import { connectCdpSession } from '../packages/research-crawler/dist/core/chrome/cdp-session.js'
import { openChromeTab } from '../packages/research-crawler/dist/core/chrome/chrome-connector.js'

const PORT = 9222
const ORIGIN = `http://127.0.0.1:${PORT}`
const BASE = 'https://chat.qwen.ai/'
const SEND_PROMPT = process.env.SEND_PROMPT || ''
const log = (...a) => console.error('[discover-qwen]', ...a)
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---- resolve the login profile EXACTLY like the backend (services.ts + chrome-defaults.ts) ---- */
function getDataDir() {
  if (process.env.ANUBIS_DATA_DIR) return process.env.ANUBIS_DATA_DIR
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, 'Anubis', 'anubis')
  if (process.env.XDG_DATA_HOME) return join(process.env.XDG_DATA_HOME, 'anubis')
  const home = homedir()
  return home ? join(home, '.local', 'share', 'anubis') : join(tmpdir(), 'anubis')
}
function readConfig(dataDir) {
  const p = join(dataDir, 'config.json')
  if (!existsSync(p)) return {}
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return {} }
}
function resolveLoginProfileDir() {
  const dataDir = getDataDir()
  const cfg = readConfig(dataDir)
  const appProfile = resolve(join(dataDir, 'chrome-profiles', 'chrome-profile-login'))
  let chosen = appProfile
  if (!existsSync(appProfile) && typeof cfg.crawlerProfileRoot === 'string' && cfg.crawlerProfileRoot.trim()) {
    const root = resolve(cfg.crawlerProfileRoot.trim())
    const direct = basename(root).toLowerCase() === 'chrome-profile-login' ? root : resolve(join(root, 'chrome-profile-login'))
    chosen = existsSync(direct) ? direct : resolve(join(root, 'data', 'chrome-profile-login'))
  }
  return { dataDir, chromePath: cfg.chromePath, profileDir: chosen, configExists: existsSync(join(dataDir, 'config.json')) }
}

const resolved = resolveLoginProfileDir()
log('login profile (same as UI):', resolved.profileDir, existsSync(resolved.profileDir) ? '(exists)' : '(fresh)')

await launchChrome({
  remoteDebuggingPort: PORT,
  profile: 'login',
  url: BASE,
  profileDir: resolved.profileDir,
  ...(resolved.chromePath ? { chromePath: resolved.chromePath } : {}),
})
await delay(2000)

const target = await openChromeTab({ chromeOrigin: ORIGIN, url: BASE })
if (!target.webSocketDebuggerUrl) throw new Error('no ws debugger url for qwen tab')
const session = await connectCdpSession(target.webSocketDebuggerUrl)
log('CDP connected to', target.url)
await session.send('Runtime.enable')
await session.send('Page.enable')
await session.send('Network.enable')

async function evalPage(expr) {
  const res = await session.send('Runtime.evaluate', {
    expression: `(async () => { ${expr} })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (res.exceptionDetails) return { __error: res.exceptionDetails.exception?.description || JSON.stringify(res.exceptionDetails) }
  return res.result?.value
}

/* ---- passively record every API request the page fires ---- */
const apiRequests = new Map() // requestId -> { url, method, hasAuth, postDataSnippet }
const apiResponses = new Map() // requestId -> { url, status, mimeType }
function isQwenApi(url) {
  return /qwen\.ai\/(api|backend)/i.test(url) || /qwen\.ai\/.*\/(chats|conversation|completion|chat\/)/i.test(url)
}
session.on('Network.requestWillBeSent', (p) => {
  const url = p?.request?.url || ''
  if (!isQwenApi(url)) return
  const headers = p.request.headers || {}
  apiRequests.set(p.requestId, {
    url,
    method: p.request.method,
    authHeader: Object.keys(headers).find((h) => h.toLowerCase() === 'authorization') ? 'Bearer ***' : null,
    headerNames: Object.keys(headers),
    postDataSnippet: (p.request.postData || '').slice(0, 400),
  })
})
session.on('Network.responseReceived', (p) => {
  const url = p?.response?.url || ''
  if (!isQwenApi(url)) return
  apiResponses.set(p.requestId, { url, status: p.response.status, mimeType: p.response.mimeType })
})

function mergedApiCalls() {
  const out = []
  const ids = new Set([...apiRequests.keys(), ...apiResponses.keys()])
  for (const id of ids) {
    const req = apiRequests.get(id) || {}
    const res = apiResponses.get(id) || {}
    out.push({ url: req.url || res.url, method: req.method, status: res.status, mimeType: res.mimeType, authHeader: req.authHeader, headerNames: req.headerNames, postDataSnippet: req.postDataSnippet })
  }
  // de-dupe by url+method, keep first
  const seen = new Set()
  return out.filter((c) => { const k = `${c.method} ${c.url}`; if (seen.has(k)) return false; seen.add(k); return true })
}

/* ---- 1. wait for login (poll up to ~4 min) ---- */
log('>>> Please LOG IN to chat.qwen.ai in the opened window. Waiting up to 4 minutes...')
let auth = null
const loginDeadline = Date.now() + 240000
while (Date.now() < loginDeadline) {
  auth = await evalPage(`
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = (localStorage.getItem(k)||'').slice(0, 40); }
    // Heuristics for the bearer token used by Open-WebUI-style backends:
    const tokenKey = Object.keys(ls).find(k => /token/i.test(k) && (localStorage.getItem(k)||'').length > 20);
    const token = tokenKey ? localStorage.getItem(tokenKey) : null;
    const cookies = document.cookie;
    return {
      href: location.href,
      lsKeys: Object.keys(ls),
      tokenKey,
      tokenSample: token ? token.slice(0, 16) + '...' : null,
      tokenLen: token ? token.length : 0,
      cookieNames: cookies.split(';').map(c => c.trim().split('=')[0]).filter(Boolean),
    };
  `)
  if (auth?.tokenKey || (auth?.cookieNames || []).some((c) => /token|ssxmod|tfstk|session/i.test(c))) break
  await delay(4000)
}
log('AUTH =>', JSON.stringify(auth, null, 2))

/* ---- 2. probe candidate list endpoints with the token (Open-WebUI-style hypotheses) ---- */
const listProbe = await evalPage(`
  const tokenKey = ${JSON.stringify(auth?.tokenKey || '')};
  const token = tokenKey ? localStorage.getItem(tokenKey) : null;
  const headers = token ? { Authorization: 'Bearer ' + token } : {};
  const candidates = [
    '/api/v2/chats/?page=1',
    '/api/v1/chats/?page=1',
    '/api/v2/chats/list',
    '/api/v1/chats/list',
    '/api/chats/?page=1',
  ];
  const results = [];
  for (const path of candidates) {
    try {
      const r = await fetch(path, { credentials: 'include', headers });
      let j = null; try { j = await r.json(); } catch {}
      const arr = Array.isArray(j) ? j : (Array.isArray(j?.data) ? j.data : (Array.isArray(j?.items) ? j.items : null));
      results.push({ path, status: r.status, isArray: Array.isArray(j), count: arr ? arr.length : null, firstKeys: arr && arr[0] ? Object.keys(arr[0]) : (j ? Object.keys(j).slice(0,8) : null), first: arr && arr[0] ? { id: arr[0].id, title: arr[0].title, updated_at: arr[0].updated_at } : null });
    } catch (e) { results.push({ path, error: String(e).slice(0,120) }); }
  }
  return results;
`)
log('LIST PROBE =>', JSON.stringify(listProbe, null, 2))

/* ---- 3. detail-shape probe for the first chat id we found ---- */
let firstId = null
if (Array.isArray(listProbe)) {
  const hit = listProbe.find((r) => r.first && r.first.id)
  firstId = hit?.first?.id || null
}
let detailProbe = null
if (firstId) {
  detailProbe = await evalPage(`
    const tokenKey = ${JSON.stringify(auth?.tokenKey || '')};
    const token = tokenKey ? localStorage.getItem(tokenKey) : null;
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    const candidates = ['/api/v2/chats/${firstId}', '/api/v1/chats/${firstId}', '/api/chats/${firstId}'];
    for (const path of candidates) {
      try {
        const r = await fetch(path, { credentials: 'include', headers });
        if (r.status !== 200) continue;
        const j = await r.json();
        const chat = j.chat || j;
        const history = chat.history || null;
        const msgs = history && history.messages ? Object.values(history.messages) : (Array.isArray(chat.messages) ? chat.messages : []);
        const sample = msgs.slice(0, 4).map(m => ({ role: m.role, hasContent: typeof m.content === 'string', contentLen: (m.content||'').length, keys: Object.keys(m).slice(0,10) }));
        return { path, status: r.status, topKeys: Object.keys(j), chatKeys: Object.keys(chat), hasHistory: !!history, historyKeys: history ? Object.keys(history) : null, currentId: history ? history.currentId : null, msgCount: msgs.length, sample };
      } catch (e) { /* try next */ }
    }
    return { error: 'no detail endpoint returned 200' };
  `)
  log('DETAIL PROBE =>', JSON.stringify(detailProbe, null, 2))
}

/* ---- 4. DOM probe: composer / send / stop / assistant message selectors ---- */
const domProbe = await evalPage(`
  function info(sel) { const el = document.querySelector(sel); return el ? { tag: el.tagName, id: el.id, cls: (el.className||'').toString().slice(0,80) } : null; }
  const textareas = [...document.querySelectorAll('textarea')].map(t => ({ id: t.id, name: t.name, ph: t.placeholder, cls: (t.className||'').slice(0,60) }));
  const editables = [...document.querySelectorAll('[contenteditable="true"]')].map(e => ({ id: e.id, cls: (e.className||'').slice(0,60) }));
  const buttons = [...document.querySelectorAll('button')].slice(0, 40).map(b => ({ aria: b.getAttribute('aria-label'), testid: b.getAttribute('data-testid'), type: b.type, txt: (b.innerText||'').slice(0,20), cls: (b.className||'').toString().slice(0,50) })).filter(b => b.aria || b.testid || b.txt);
  // candidate message containers
  const roleEls = [...document.querySelectorAll('[data-message-role], [data-role], [class*="message"]')].slice(0,6).map(e => ({ tag: e.tagName, role: e.getAttribute('data-message-role')||e.getAttribute('data-role'), cls: (e.className||'').toString().slice(0,80) }));
  return { href: location.href, textareas, editables, buttons, roleEls };
`)
log('DOM PROBE =>', JSON.stringify(domProbe, null, 2))

/* ---- 5. optionally send a prompt and capture the send request + streaming behavior ---- */
let sendCapture = null
if (SEND_PROMPT) {
  log('Capturing send-message request for prompt:', JSON.stringify(SEND_PROMPT))
  const beforeCount = mergedApiCalls().length
  // focus composer + type
  await evalPage(`
    const ta = document.querySelector('textarea, [contenteditable="true"]');
    if (ta) ta.focus();
    return !!ta;
  `)
  await session.send('Input.insertText', { text: SEND_PROMPT })
  await delay(400)
  // submit: click a likely send button, else press Enter
  const submitResult = await evalPage(`
    const btn = document.querySelector('button[aria-label*="Send" i], button[data-testid*="send" i], button[type="submit"]');
    if (btn && !btn.disabled) { btn.click(); return 'clicked:' + (btn.getAttribute('aria-label')||btn.getAttribute('data-testid')||'?'); }
    const ta = document.querySelector('textarea, [contenteditable="true"]');
    if (ta) { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })); return 'enter'; }
    return 'no-target';
  `)
  await delay(7000) // let the POST fire + streaming start
  const newCalls = mergedApiCalls().slice(beforeCount)
  const urlAfter = await evalPage(`return location.href;`)
  sendCapture = {
    submitResult,
    urlAfter,
    completionCalls: newCalls.filter((c) => c.method === 'POST'),
  }
  log('SEND CAPTURE =>', JSON.stringify(sendCapture, null, 2))
}

console.error('\n================ QWEN DISCOVERY REPORT ================')
console.error(JSON.stringify({ auth, listProbe, firstId, detailProbe, domProbe, observedApiCalls: mergedApiCalls(), sendCapture }, null, 2))
console.error('======================================================\n')
session.close()
log('done (chrome left open).')
process.exit(0)
