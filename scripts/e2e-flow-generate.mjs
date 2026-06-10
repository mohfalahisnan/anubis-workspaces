// Step 5 (doc): end-to-end verification of the REAL flowGenerate() public API
// against the live flow-profile Chrome. Reloads the project first (simulates a
// fresh open), then calls flowGenerate with variations=1 + a download dir, and
// asserts real outcomes. Throwaway diagnostic — delete after the feature is locked.
//
// Requires the flow-profile Chrome on a project tab (port 9224). Run from root:
//   node scripts/e2e-flow-generate.mjs
//   FLOW_MODEL="Nano Banana 2" FLOW_NO_RELOAD=1 node scripts/e2e-flow-generate.mjs

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flowGenerate } from '../packages/research-crawler/dist/core/flow/flow-generate.js'
import { connectCdpSession } from '../packages/research-crawler/dist/core/chrome/cdp-session.js'
import { listChromeTargets } from '../packages/research-crawler/dist/core/chrome/chrome-connector.js'

const ORIGIN = 'http://127.0.0.1:9224'
const PROJECT_PART = '/tools/flow/project/'
const PROMPT = process.env.FLOW_PROMPT || 'a single yellow lemon on a plain white background, studio photo'
const MODEL = process.env.FLOW_MODEL || 'Nano Banana Pro'
const log = (...a) => console.error('[e2e-flow]', ...a)
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- optional clean-state reload so flowGenerate starts from an idle tab ----
if (!process.env.FLOW_NO_RELOAD) {
  const targets = await listChromeTargets({ chromeOrigin: ORIGIN }).catch(() => [])
  const t = targets.find((x) => x.type === 'page' && x.webSocketDebuggerUrl && x.url.includes(PROJECT_PART))
  if (!t) { log('No Flow project tab on 9224. Run discover-flow-ui.mjs first.'); process.exit(0) }
  const s = await connectCdpSession(t.webSocketDebuggerUrl)
  await s.send('Page.enable'); await s.send('Runtime.enable')
  log('reloading project for a clean idle state...')
  await s.send('Page.reload', {})
  // wait until the prompt editor exists again
  const deadline = Date.now() + 25000
  let ready = false
  while (Date.now() < deadline) {
    const r = await s.send('Runtime.evaluate', { expression: `document.querySelectorAll('[contenteditable="true"]').length`, returnByValue: true }).catch(() => null)
    if (r?.result?.value > 0) { ready = true; break }
    await delay(700)
  }
  log('editor ready after reload:', ready)
  s.close()
  await delay(800)
}

const downloadDir = await mkdtemp(join(tmpdir(), 'flow-e2e-'))
log('calling flowGenerate()', JSON.stringify({ model: MODEL, downloadDir }))

try {
  const result = await flowGenerate({
    prompt: PROMPT,
    ratio: '1:1',
    variations: 1,
    model: MODEL,
    downloadDir,
    generateTimeoutMs: 120000,
  })
  console.error('\n================ flowGenerate RESULT ================')
  console.error(JSON.stringify(result, null, 2))
  console.error('=====================================================\n')
  log('resultEditUrls:', result.resultEditUrls?.length, '| downloaded:', result.downloadedImagePaths?.length)
} catch (err) {
  console.error('\n================ flowGenerate THREW ================')
  console.error(String(err?.stack || err))
  console.error('===================================================\n')
}

process.exit(0)
