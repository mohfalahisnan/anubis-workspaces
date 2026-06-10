// Discovery harness: drive the real Google Flow flow-profile Chrome over CDP and
// learn the ACTUAL DOM shape that `flow-generate.ts` automates. Read-only by
// default — it does NOT submit a generation (so it won't burn quota). Mirrors
// scripts/discover-chatgpt-api.mjs but for Flow's pure-DOM control surface.
//
// Usage (from repo root, build the crawler first):
//   pnpm --filter @anubis/research-crawler build
//   node scripts/discover-flow-ui.mjs
//   FLOW_URL="https://labs.google/fx/id/tools/flow/project/<id>" node scripts/discover-flow-ui.mjs
//
// It opens a headed Chrome on the `flow` profile (port 9224) and waits up to
// ~5 min for you to log in to your Google account AND open/create a Flow
// project (URL contains /tools/flow/project/). Then it dumps every selector
// assumption baked into flow-generate.ts so we can see what actually matches.

import { homedir, tmpdir } from 'node:os'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { launchChrome } from '../packages/research-crawler/dist/core/chrome/launch-chrome.js'
import { connectCdpSession } from '../packages/research-crawler/dist/core/chrome/cdp-session.js'
import { listChromeTargets } from '../packages/research-crawler/dist/core/chrome/chrome-connector.js'

const PORT = 9224
const ORIGIN = `http://127.0.0.1:${PORT}`
const FLOW_URL = process.env.FLOW_URL || 'https://labs.google/fx/id/tools/flow'
const PROJECT_PART = '/tools/flow/project/'
const log = (...a) => console.error('[discover-flow]', ...a)
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---- resolve the flow profile dir the way profile-resolver.ts does ---- */
function getDataDir() {
  if (process.env.ANUBIS_DATA_DIR) return process.env.ANUBIS_DATA_DIR
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, 'Anubis', 'anubis')
  if (process.env.XDG_DATA_HOME) return join(process.env.XDG_DATA_HOME, 'anubis')
  const home = homedir()
  return home ? join(home, '.local', 'share', 'anubis') : join(tmpdir(), 'anubis')
}
function resolveFlowProfileDir() {
  const dataDir = getDataDir()
  const appProfile = resolve(join(dataDir, 'chrome-profiles', 'chrome-profile-flow'))
  // package-default fallback (packages/research-crawler/data/chrome-profile-flow)
  const pkgProfile = resolve(join(process.cwd(), 'packages', 'research-crawler', 'data', 'chrome-profile-flow'))
  const cfgPath = join(dataDir, 'config.json')
  let chromePath
  if (existsSync(cfgPath)) {
    try { chromePath = JSON.parse(readFileSync(cfgPath, 'utf8')).chromePath } catch { /* ignore */ }
  }
  const profileDir = existsSync(appProfile) ? appProfile : existsSync(pkgProfile) ? pkgProfile : appProfile
  return { dataDir, profileDir, chromePath }
}

const resolved = resolveFlowProfileDir()
log('flow profile dir:', resolved.profileDir, existsSync(resolved.profileDir) ? '(exists)' : '(fresh)')

await launchChrome({
  remoteDebuggingPort: PORT,
  profile: 'flow',
  url: FLOW_URL,
  profileDir: resolved.profileDir,
  ...(resolved.chromePath ? { chromePath: resolved.chromePath } : {}),
})
await delay(2500)

const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms)),
])

async function pickFlowTab() {
  const targets = await listChromeTargets({ chromeOrigin: ORIGIN }).catch(() => [])
  return targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && t.url.includes(PROJECT_PART))
    ?? targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && /labs\.google/.test(t.url))
    ?? targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
}

// Fresh-profile Chrome opens on chrome://intro/ and may ignore the launch URL.
// Reconnect each cycle (so a stale socket after navigation can't hang us) and
// nudge a non-Flow tab toward FLOW_URL once.
let nudged = false
async function probeOnce() {
  const target = await pickFlowTab()
  if (!target) return null
  let session
  try {
    session = await withTimeout(connectCdpSession(target.webSocketDebuggerUrl), 5000, 'connect')
    await withTimeout(session.send('Runtime.enable'), 5000, 'Runtime.enable')
    await withTimeout(session.send('Page.enable'), 5000, 'Page.enable')
    if (!target.url.includes('labs.google') && !nudged) {
      nudged = true
      await session.send('Page.navigate', { url: FLOW_URL }).catch(() => {})
      return { href: target.url, onProject: false, navigatedTo: FLOW_URL }
    }
    const res = await withTimeout(session.send('Runtime.evaluate', {
      expression: `(async () => {
        return {
          href: location.href,
          onProject: location.href.includes('${PROJECT_PART}'),
          contentEditables: document.querySelectorAll('[contenteditable="true"]').length,
          buttonCount: document.querySelectorAll('button').length
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    }), 8000, 'evaluate')
    if (res.exceptionDetails) return { __error: res.exceptionDetails.exception?.description || 'eval error' }
    return { ...res.result?.value, _ws: target.webSocketDebuggerUrl }
  } catch (err) {
    return { __error: String(err?.message || err) }
  } finally {
    try { session?.close() } catch { /* ignore */ }
  }
}

/* ---- 1. wait until we're inside a Flow project with the editor present ---- */
log(`>>> Log in to Google AND open/create a Flow project (URL must contain ${PROJECT_PART}).`)
log('    Waiting up to ~5 minutes...')
const deadline = Date.now() + 300000
let ready = null
let lastHref = null
while (Date.now() < deadline) {
  ready = await probeOnce()
  if (ready?.href && ready.href !== lastHref) { lastHref = ready.href; log('tab url =>', ready.href) }
  if (ready && !ready.__error && ready.onProject && ready.contentEditables > 0) break
  await delay(4000)
}
log('READY =>', JSON.stringify({ ...ready, _ws: undefined }))
if (!ready || ready.__error || !ready.onProject) {
  log('Not on a Flow project with an editor after timeout. Navigate there and re-run. (chrome left open)')
  process.exit(0)
}

/* ---- 2. dump EVERY selector assumption flow-generate.ts relies on ---- */
const session = await connectCdpSession(ready._ws)
await session.send('Runtime.enable')
async function evalPage(expr) {
  const res = await session.send('Runtime.evaluate', {
    expression: `(async () => { ${expr} })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (res.exceptionDetails) return { __error: res.exceptionDetails.exception?.description || JSON.stringify(res.exceptionDetails) }
  return res.result?.value
}
const report = await evalPage(`
  const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const buttons = [...document.querySelectorAll('button')];
  const btnDump = buttons.map((b, i) => ({
    i,
    text: norm(b.innerText),
    lines: (b.innerText || '').trim().split(/\\n+/).map((l) => l.trim()).filter(Boolean),
    ariaLabel: b.getAttribute('aria-label') || null,
    title: b.getAttribute('title') || null,
    disabled: b.disabled || null
  })).filter((b) => b.text || b.ariaLabel || b.title);

  const has = (re) => buttons.filter((b) => re.test(b.innerText || ''));
  const tokenButtons = (tok) => buttons
    .filter((b) => (b.innerText || '').split(/\\s+/).includes(tok))
    .map((b) => norm(b.innerText));

  return {
    href: location.href,
    lang: document.documentElement.lang || null,

    // promptEl(): first [contenteditable="true"]
    contentEditables: [...document.querySelectorAll('[contenteditable="true"]')].map((el) => ({
      tag: el.tagName, cls: el.className?.slice(0, 80) || null, placeholder: el.getAttribute('data-placeholder') || el.getAttribute('aria-label') || null
    })),

    // settingsButton(): /Nano Banana/i AND /crop_/
    nanoBananaButtons: has(/Nano Banana/i).map((b) => norm(b.innerText)),
    cropTokenButtons: buttons.filter((b) => /crop_/.test(b.innerText || '')).map((b) => norm(b.innerText)),

    // modelDropdownButton(): /Nano Banana/i + token arrow_drop_down
    arrowDropDownButtons: tokenButtons('arrow_drop_down'),

    // submit: token arrow_forward
    arrowForwardButtons: tokenButtons('arrow_forward'),

    // ratioButton(): 2-line [icon, ratio]
    twoLineButtons: btnDump.filter((b) => b.lines.length === 2).map((b) => b.lines),

    // variationButton(): text exactly x{n}/{n}x
    variationLikeButtons: btnDump.filter((b) => /^(x[1-4]|[1-4]x)$/i.test(b.text)).map((b) => b.text),

    // result links + generated images (completion signals)
    editLinkCount: document.querySelectorAll('a[href*="/edit/"]').length,
    mediaRedirectImgCount: [...document.querySelectorAll('img')].filter((im) => /getMediaUrlRedirect/.test(im.src)).length,
    dihasilkanAltImgCount: [...document.querySelectorAll('img')].filter((im) => /dihasilkan/i.test(im.alt || '')).length,
    progressTextPresent: /\\b\\d{1,3}%/.test(document.body.innerText || ''),

    // full button inventory (the ground truth)
    buttons: btnDump
  };
`)

console.error('\n================ FLOW DOM DISCOVERY ================')
console.error(JSON.stringify(report, null, 2))
console.error('===================================================\n')
await delay(150)
session.close()
await delay(150)
log('done (chrome left open). Re-run discover-flow-settings.mjs next.')
process.exit(0)
