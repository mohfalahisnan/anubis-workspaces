// Discovery harness: drive the real ChatGPT login-profile Chrome over CDP and
// learn (a) how to read a conversation's detail and (b) what the send-message
// request looks like. Resolves the SAME login profile the playground UI uses.
//
// Usage (from repo root):
//   node scripts/discover-chatgpt-api.mjs              # auth + list + detail
//   SEND_PROMPT="hi there" node scripts/discover-chatgpt-api.mjs   # also send a prompt and capture the POST
//
// It waits (polls) up to ~4 min for you to log in to ChatGPT in the window it opens.

import { homedir, tmpdir } from 'node:os'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { launchChrome } from '../packages/research-crawler/dist/core/chrome/launch-chrome.js'
import { connectCdpSession } from '../packages/research-crawler/dist/core/chrome/cdp-session.js'
import { openChromeTab } from '../packages/research-crawler/dist/core/chrome/chrome-connector.js'

const PORT = 9222
const ORIGIN = `http://127.0.0.1:${PORT}`
const SEND_PROMPT = process.env.SEND_PROMPT || ''
const log = (...a) => console.error('[discover]', ...a)
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
  url: 'https://chatgpt.com/',
  profileDir: resolved.profileDir,
  ...(resolved.chromePath ? { chromePath: resolved.chromePath } : {}),
})
await delay(2000)

const target = await openChromeTab({ chromeOrigin: ORIGIN, url: 'https://chatgpt.com/' })
if (!target.webSocketDebuggerUrl) throw new Error('no ws debugger url for chatgpt tab')
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

/* ---- 1. wait for login (poll up to ~4 min) ---- */
log('>>> Please LOG IN to ChatGPT in the opened window. Waiting up to 4 minutes...')
let sessionInfo = null
const loginDeadline = Date.now() + 240000
while (Date.now() < loginDeadline) {
  sessionInfo = await evalPage(`
    const r = await fetch('/api/auth/session', { credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, hasAccessToken: !!j.accessToken, accessTokenSample: j.accessToken ? j.accessToken.slice(0,12)+'...' : null, user: j.user?.email || null };
  `)
  if (sessionInfo?.hasAccessToken) break
  await delay(4000)
}
log('AUTH =>', JSON.stringify(sessionInfo))
if (!sessionInfo?.hasAccessToken) {
  log('Still not logged in after timeout. Log in and re-run. (chrome left open)')
  session.close(); process.exit(0)
}
log('Logged in as', sessionInfo.user)

/* ---- 2. list conversations via token-authed page fetch ---- */
const list = await evalPage(`
  const s = await fetch('/api/auth/session', { credentials: 'include' }).then(r => r.json());
  const token = s.accessToken;
  const r = await fetch('/backend-api/conversations?offset=0&limit=5&order=updated', { credentials: 'include', headers: { Authorization: 'Bearer ' + token } });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, total: j.total, count: (j.items||[]).length, firstId: j.items?.[0]?.id, firstTitle: j.items?.[0]?.title };
`)
log('LIST =>', JSON.stringify(list))

/* ---- 3. conversation detail shape via token-authed page fetch ---- */
let detail = null
if (list?.firstId) {
  detail = await evalPage(`
    const s = await fetch('/api/auth/session', { credentials: 'include' }).then(r => r.json());
    const token = s.accessToken;
    const r = await fetch('/backend-api/conversation/${list.firstId}', { credentials: 'include', headers: { Authorization: 'Bearer ' + token } });
    const j = await r.json().catch(() => ({}));
    const mapping = j.mapping || {};
    const ids = Object.keys(mapping);
    const sample = ids.slice(0,4).map(id => { const m = mapping[id]?.message; return m ? { role: m.author?.role, ctype: m.content?.content_type, parts: Array.isArray(m.content?.parts)?m.content.parts.length:null } : null; });
    return { status: r.status, contentType: r.headers.get('content-type'), topKeys: Object.keys(j), title: j.title, current_node: j.current_node, nodeCount: ids.length, sample };
  `)
  log('DETAIL =>', JSON.stringify(detail, null, 2))
}

/* ---- 4. optionally send a prompt and capture the send-message request ---- */
let sendCapture = null
if (SEND_PROMPT) {
  log('Capturing send-message request for prompt:', JSON.stringify(SEND_PROMPT))
  const reqs = []
  session.on('Network.requestWillBeSent', (p) => {
    const url = p?.request?.url || ''
    if (url.includes('/backend-api/') && p.request.method === 'POST') {
      reqs.push({ url, method: p.request.method, headers: p.request.headers, postDataSnippet: (p.request.postData || '').slice(0, 600) })
    }
  })
  // type into the composer and submit via DOM
  await evalPage(`
    const ta = document.querySelector('#prompt-textarea, [contenteditable="true"], textarea');
    if (ta) { ta.focus(); }
    return !!ta;
  `)
  await session.send('Input.insertText', { text: SEND_PROMPT })
  await delay(300)
  await evalPage(`
    const btn = document.querySelector('button[data-testid="send-button"], button[aria-label="Send message"], button[data-testid*="send"]');
    if (btn) { btn.click(); return 'clicked'; }
    return 'no-button';
  `)
  await delay(6000) // let the POST fire + streaming start
  sendCapture = {
    capturedPosts: reqs.map((r) => ({
      url: r.url,
      method: r.method,
      sentinelHeaders: Object.keys(r.headers).filter((h) => /sentinel|openai|authorization|oai/i.test(h)),
      postDataSnippet: r.postDataSnippet,
    })),
  }
  log('SEND CAPTURE =>', JSON.stringify(sendCapture, null, 2))
}

console.error('\n================ DISCOVERY REPORT ================')
console.error(JSON.stringify({ sessionInfo, list, detail, sendCapture }, null, 2))
console.error('=================================================\n')
session.close()
log('done (chrome left open).')
process.exit(0)
