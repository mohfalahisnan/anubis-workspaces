// Stage 3 discovery (v2, controlled): clean-state single generation with network
// capture, to answer (a) does clicking submit fire a backend generation request,
// (b) does the prompt actually land in the editor, (c) what do the real
// completion/result signals look like. Mirrors the ChatGPT doc's Steps 3b+4.
//
// Requires the flow-profile Chrome on a project tab (port 9224). Run from root:
//   node scripts/discover-flow-generate.mjs
//   FLOW_PROMPT="a single red apple on white" FLOW_VARIATIONS=1 node scripts/discover-flow-generate.mjs

import { connectCdpSession } from '../packages/research-crawler/dist/core/chrome/cdp-session.js'
import { listChromeTargets } from '../packages/research-crawler/dist/core/chrome/chrome-connector.js'

const ORIGIN = 'http://127.0.0.1:9224'
const PROJECT_PART = '/tools/flow/project/'
const PROMPT = process.env.FLOW_PROMPT || 'a single red apple on a plain white background, studio photo'
const VARIATIONS = Number(process.env.FLOW_VARIATIONS || 1)
const log = (...a) => console.error('[gen-probe]', ...a)
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

const FLOW_HELPERS = `
window.__flow = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  btnByIcon(name) { return [...document.querySelectorAll('button')].find((b) => (b.innerText||'').split(/\\s+/).includes(name)); },
  ratioButton(icon, ratio) {
    return [...document.querySelectorAll('button')].find((b) => {
      const lines = (b.innerText||'').trim().split(/\\n+/).map((l)=>l.trim()).filter(Boolean);
      return lines.length === 2 && lines[0] === icon && lines[1] === ratio;
    });
  },
  variationButton(v) { return [...document.querySelectorAll('button')].find((b) => this.isVariationText(b.innerText||'', v)); },
  isVariationText(text, v) { const n = String(text||'').trim().toLowerCase(); return n === 'x'+v || n === v+'x'; },
  settingsButton() { return [...document.querySelectorAll('button')].find((b) => /Nano Banana/i.test(b.innerText||'') && /crop_/.test(b.innerText||'')); },
  settingsOpen() { return Boolean(this.variationButton(4) || this.ratioButton('crop_square','1:1')); },
  promptEl() { return [...document.querySelectorAll('[contenteditable="true"]')][0] || null; },
  resultLinkCount() { return document.querySelectorAll('a[href*="/edit/"]').length; },
  anyProgressVisible() { return /\\b\\d{1,3}%/.test(document.body.innerText||''); },
  generatedImageUrls() {
    return [...document.querySelectorAll('img')]
      .filter((im) => /getMediaUrlRedirect/.test(im.src) || /dihasilkan/i.test(im.alt||''))
      .map((im) => im.currentSrc || im.src).filter((v,i,a)=> v && a.indexOf(v)===i);
  },
  async waitFor(fn, timeout=10000, step=150) { const end=Date.now()+timeout; while(Date.now()<end){const v=fn(); if(v) return v; await this.sleep(step);} return null; }
};
true;
`

const targets = await listChromeTargets({ chromeOrigin: ORIGIN }).catch(() => [])
const target = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && t.url.includes(PROJECT_PART))
if (!target) { log('No Flow project tab on 9224. Run discover-flow-ui.mjs first.'); process.exit(0) }
const session = await connectCdpSession(target.webSocketDebuggerUrl)
await session.send('Runtime.enable')
await session.send('Page.enable')
await session.send('Network.enable')
log('connected to', target.url)

// ---- network capture: log generation-ish traffic and any POST ----
const net = []
session.on('Network.requestWillBeSent', (p) => {
  const url = p?.request?.url || ''
  const method = p?.request?.method || ''
  if (method === 'POST' || /aisandbox|generate|batchexecute|GenerateImage|runImageFx|media|pinhole|flow/i.test(url)) {
    net.push({ t: Date.now(), method, url: url.slice(0, 140), postLen: (p.request.postData || '').length })
  }
})
session.on('Network.responseReceived', (p) => {
  const url = p?.response?.url || ''
  if (/aisandbox|generate|batchexecute|GenerateImage|runImageFx/i.test(url)) {
    net.push({ t: Date.now(), status: p.response.status, url: url.slice(0, 140), kind: 'response' })
  }
})

async function evalPage(body) {
  const res = await session.send('Runtime.evaluate', { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true })
  if (res.exceptionDetails) return { __error: res.exceptionDetails.exception?.description || JSON.stringify(res.exceptionDetails) }
  return res.result?.value
}
async function clickByExpr(expr) {
  const rect = await evalPage(`const el=${expr}; if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height};`)
  if (!rect || rect.__error || !(rect.width > 0)) return false
  const x = rect.x + rect.width/2, y = rect.y + rect.height/2
  await session.send('Input.dispatchMouseEvent', { type:'mouseMoved', x, y, button:'none' })
  await session.send('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', clickCount:1 })
  await session.send('Input.dispatchMouseEvent', { type:'mouseReleased', x, y, button:'left', clickCount:1 })
  return true
}

// ---- 0. clean state: reload, wait for the editor ----
log('reloading project for a clean state...')
await session.send('Page.reload', {})
await delay(1500)
await evalPage(FLOW_HELPERS)
const editorReady = await evalPage(`const el = await __flow.waitFor(() => __flow.promptEl(), 20000); return !!el;`)
log('editor present after reload:', JSON.stringify(editorReady))
await evalPage(FLOW_HELPERS)

// ---- 1. type the prompt, READ IT BACK ----
await evalPage(`
  const el = __flow.promptEl();
  el.focus(); const sel=window.getSelection(); sel.removeAllRanges();
  const range=document.createRange(); range.selectNodeContents(el); sel.addRange(range);
  document.execCommand('delete', false); return true;
`)
await session.send('Input.insertText', { text: PROMPT })
await delay(300)
const readback = await evalPage(`const el=__flow.promptEl(); return { text: (el?.innerText||'').slice(0,120), len: (el?.innerText||'').length };`)
log('PROMPT READBACK =>', JSON.stringify(readback))

// ---- 2. open settings (correct detection), set ratio 1:1 + variations ----
let open = await evalPage(`return __flow.settingsOpen();`)
log('settingsOpen:', JSON.stringify(open))
if (!open) { await clickByExpr('__flow.settingsButton()'); await delay(800); open = await evalPage(`return __flow.settingsOpen();`); log('settingsOpen after click:', JSON.stringify(open)) }
const setRatio = await clickByExpr(`__flow.ratioButton('crop_square','1:1')`); await delay(250)
const setVar = await clickByExpr(`__flow.variationButton(${VARIATIONS})`); await delay(250)
log('set ratio/variation:', JSON.stringify({ setRatio, setVar }))
// NOTE: leaving the default model (skip dropdown) so a stray overlay can't block submit.

// ---- 3. inspect the submit button, then click ----
const submitInfo = await evalPage(`
  const b=__flow.btnByIcon('arrow_forward'); if(!b) return null;
  const r=b.getBoundingClientRect();
  return { text:(b.innerText||'').replace(/\\s+/g,' ').trim(), disabled:b.disabled, ariaDisabled:b.getAttribute('aria-disabled'),
           x:r.x, y:r.y, w:r.width, h:r.height, visible:r.width>0&&r.height>0 };
`)
log('SUBMIT BUTTON =>', JSON.stringify(submitInfo))
const before = await evalPage(`return { resultLinks: __flow.resultLinkCount(), imageUrls: __flow.generatedImageUrls().length, totalImgs: document.querySelectorAll('img').length };`)
const submitted = await clickByExpr(`__flow.btnByIcon('arrow_forward')`)
log('submitted click dispatched:', JSON.stringify(submitted), 'before:', JSON.stringify(before))

// ---- 4. observe completion signals + network over time ----
const deadline = Date.now() + 120000
let tick = 0
while (Date.now() < deadline) {
  tick += 1
  const snap = await evalPage(`
    const imgs=[...document.querySelectorAll('img')];
    const m=(document.body.innerText||'').match(/\\b\\d{1,3}%/);
    return {
      resultLinks: __flow.resultLinkCount(),
      matchedImageUrls: __flow.generatedImageUrls().length,
      totalImgs: imgs.length,
      progressing: __flow.anyProgressVisible(),
      progressText: m ? m[0] : null,
      newestImg: imgs.slice(-1).map((im)=>({ src:(im.currentSrc||im.src||'').slice(0,70), alt:(im.alt||'').slice(0,30) }))[0] || null
    };
  `)
  if (tick % 3 === 0 || (snap && (snap.totalImgs !== before.totalImgs || snap.progressing))) {
    log(`t+${tick} =>`, JSON.stringify(snap), `| net:${net.length}`)
  }
  if (snap && !snap.__error && !snap.progressing && (snap.resultLinks > before.resultLinks || snap.matchedImageUrls > before.imageUrls)) {
    log('>>> COMPLETE by code logic'); break
  }
  await delay(2000)
}

// ---- 5. dumps ----
const finalDump = await evalPage(`
  const imgs=[...document.querySelectorAll('img')].filter((im)=> (im.naturalWidth||0) > 64);
  return {
    editLinks: [...document.querySelectorAll('a[href*="/edit/"]')].map((a)=>a.getAttribute('href')).slice(0,8),
    bigImgs: imgs.slice(-8).map((im)=>({ src:(im.currentSrc||im.src||'').slice(0,130), alt:(im.alt||''), w:im.naturalWidth, h:im.naturalHeight }))
  };
`)
console.error('\n================ NETWORK (generation-ish) ================')
console.error(JSON.stringify(net.slice(0, 40), null, 2))
console.error('================ FINISHED RESULT ANATOMY ================')
console.error(JSON.stringify(finalDump, null, 2))
console.error('=========================================================\n')

await delay(150); session.close(); await delay(150)
log('done (chrome left open).')
process.exit(0)
