// Stage 2 discovery: open Flow's settings popover and the model dropdown, then
// dump what's actually inside — the real ratio buttons, variation buttons, model
// dropdown trigger, and model option names. Tests the EXACT helpers from
// flow-generate.ts against the live popover. Still NO generation (no quota spent).
//
// Requires the flow-profile Chrome from discover-flow-ui.mjs still open on a
// project tab (port 9224). Run from repo root:
//   node scripts/discover-flow-settings.mjs

import { connectCdpSession } from '../packages/research-crawler/dist/core/chrome/cdp-session.js'
import { listChromeTargets } from '../packages/research-crawler/dist/core/chrome/chrome-connector.js'

const ORIGIN = 'http://127.0.0.1:9224'
const PROJECT_PART = '/tools/flow/project/'
const log = (...a) => console.error('[discover-settings]', ...a)
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

// The exact helpers flow-generate.ts injects (verbatim), so we test the real selectors.
const FLOW_HELPERS = `
window.__flow = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  btnByIcon(name) {
    return [...document.querySelectorAll('button')].find((button) => {
      const text = button.innerText || '';
      return text.split(/\\s+/).includes(name);
    });
  },
  ratioButton(icon, ratio) {
    return [...document.querySelectorAll('button')].find((button) => {
      const lines = (button.innerText || '').trim().split(/\\n+/).map((line) => line.trim()).filter(Boolean);
      return lines.length === 2 && lines[0] === icon && lines[1] === ratio;
    });
  },
  variationButton(variations) {
    return [...document.querySelectorAll('button')].find((button) => this.isVariationText(button.innerText || '', variations));
  },
  isVariationText(text, variations) {
    const normalized = String(text || '').trim().toLowerCase();
    return normalized === 'x' + variations || normalized === variations + 'x';
  },
  settingsButton() {
    return [...document.querySelectorAll('button')].find((button) => /Nano Banana/i.test(button.innerText || '') && /crop_/.test(button.innerText || ''));
  },
  modelDropdownButton() {
    return [...document.querySelectorAll('button')].find((button) => {
      const text = button.innerText || '';
      return /Nano Banana/i.test(text) && text.split(/\\s+/).includes('arrow_drop_down');
    });
  },
  settingsOpen() {
    return Boolean(this.variationButton(4) || this.ratioButton('crop_square', '1:1'));
  }
};
true;
`

const targets = await listChromeTargets({ chromeOrigin: ORIGIN }).catch(() => [])
const target = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && t.url.includes(PROJECT_PART))
if (!target) {
  log('No Flow project tab found on 9224. Open discover-flow-ui.mjs first and stay on a project.')
  process.exit(0)
}
const session = await connectCdpSession(target.webSocketDebuggerUrl)
await session.send('Runtime.enable')
await session.send('Page.enable')
log('connected to', target.url)

async function evalPage(expr) {
  const res = await session.send('Runtime.evaluate', {
    expression: `(async () => { ${expr} })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (res.exceptionDetails) return { __error: res.exceptionDetails.exception?.description || JSON.stringify(res.exceptionDetails) }
  return res.result?.value
}

async function clickByExpr(expr) {
  const rect = await evalPage(`
    const el = ${expr};
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  `)
  if (!rect || rect.__error || !(rect.width > 0)) return { clicked: false, rect }
  const x = rect.x + rect.width / 2
  const y = rect.y + rect.height / 2
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
  await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  return { clicked: true, rect }
}

const dumpExpr = `
  const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const buttons = [...document.querySelectorAll('button')];
  return {
    settingsOpen: __flow.settingsOpen(),
    hasModelDropdown: !!__flow.modelDropdownButton(),
    modelDropdownText: __flow.modelDropdownButton() ? norm(__flow.modelDropdownButton().innerText) : null,
    ratio_16_9: !!__flow.ratioButton('crop_16_9', '16:9'),
    ratio_1_1: !!__flow.ratioButton('crop_square', '1:1'),
    variation_x1: !!__flow.variationButton(1),
    variation_x2: !!__flow.variationButton(2),
    variation_x4: !!__flow.variationButton(4),
    buttonCount: buttons.length,
    buttons: buttons.map((b) => norm(b.innerText)).filter(Boolean),
    // any popover/menu containers
    roleDialogs: [...document.querySelectorAll('[role=dialog],[role=menu],[role=listbox],[data-radix-popper-content-wrapper]')].length,
    options: [...document.querySelectorAll('[role=option],[role=menuitem],li')].map((o) => norm(o.innerText)).filter(Boolean).slice(0, 40)
  };
`

await evalPage(FLOW_HELPERS)
const before = await evalPage(dumpExpr)
log('BEFORE click =>', JSON.stringify({ settingsOpen: before.settingsOpen, buttonCount: before.buttonCount }))

const clickSettings = await clickByExpr('__flow.settingsButton()')
log('clicked settingsButton:', JSON.stringify(clickSettings.clicked))
await delay(800)
await evalPage(FLOW_HELPERS) // re-inject in case of re-render
const afterSettings = await evalPage(dumpExpr)

// Try to open the model dropdown if present
let modelOptions = null
const clickModel = await clickByExpr('__flow.modelDropdownButton()')
if (clickModel.clicked) {
  await delay(700)
  modelOptions = await evalPage(`
    const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
    return [...document.querySelectorAll('[role=option],[role=menuitem],li,button')]
      .map((o) => norm(o.innerText))
      .filter((t) => /banana|imagen|model|veo|flow/i.test(t))
      .filter((v, i, a) => v && a.indexOf(v) === i)
      .slice(0, 40);
  `)
}

console.error('\n================ FLOW SETTINGS POPOVER ================')
console.error(JSON.stringify({
  afterSettings,
  modelDropdownClicked: clickModel.clicked,
  modelOptions
}, null, 2))
console.error('======================================================\n')

await delay(150)
session.close()
await delay(150)
log('done (chrome left open).')
process.exit(0)
