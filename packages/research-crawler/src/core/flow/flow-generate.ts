import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connectCdpSession, type CdpSession } from '../chrome/cdp-session.js'
import { launchChrome, type LaunchChromeInput, type LaunchChromeResult } from '../chrome/launch-chrome.js'
import { listChromeTargets, normalizeChromeOrigin, type ChromeTarget } from '../chrome/chrome-connector.js'
import { defaultPortFor, type ProfileName } from '../chrome/profile-resolver.js'

export type FlowGenerateRatio = '16:9' | '4:3' | '1:1' | '3:4' | '9:16'
export type FlowGenerateVariations = 1 | 2 | 3 | 4

export type FlowGenerateInput = {
  chromeOrigin?: string
  prompt: string
  ratio?: FlowGenerateRatio
  variations?: FlowGenerateVariations
  model?: string
  tabUrlIncludes?: string
  generateTimeoutMs?: number
  downloadDir?: string
  downloadFilePrefix?: string
  fetchImpl?: typeof fetch
  connectSession?: (webSocketDebuggerUrl: string) => Promise<CdpSession>
}

export type NormalizedFlowGenerateInput = {
  chromeOrigin: string
  prompt: string
  ratio: FlowGenerateRatio
  variations: FlowGenerateVariations
  model: string
  tabUrlIncludes: string
  generateTimeoutMs: number
  downloadDir?: string
  downloadFilePrefix?: string
  fetchImpl?: typeof fetch
  connectSession: (webSocketDebuggerUrl: string) => Promise<CdpSession>
}

export type FlowGenerateResult = {
  ok: true
  chromeOrigin: string
  tabUrl: string
  prompt: string
  ratio: FlowGenerateRatio
  variations: FlowGenerateVariations
  model: string
  resultEditUrls: string[]
  downloadedImagePaths?: string[]
}

export type FlowEvalSession = {
  eval<T = unknown>(expression: string): Promise<T>
}

export type EnsureFlowChromeInput = Omit<LaunchChromeInput, 'profile'> & {
  profile?: ProfileName
  launchChrome?: (input: LaunchChromeInput) => Promise<LaunchChromeResult>
}

const DEFAULT_FLOW_TAB_URL_PART = '/tools/flow/project/'

const RATIO_ICON: Record<FlowGenerateRatio, string> = {
  '16:9': 'crop_16_9',
  '4:3': 'crop_landscape',
  '1:1': 'crop_square',
  '3:4': 'crop_portrait',
  '9:16': 'crop_9_16'
}

const FLOW_HELPERS = `
window.__flow = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  btnByText(re) {
    return [...document.querySelectorAll('button')].find((button) => re.test(button.innerText || ''));
  },
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
  },
  promptEl() {
    return [...document.querySelectorAll('[contenteditable="true"]')][0] || null;
  },
  async waitFor(fn, timeout = 8000, step = 150) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const value = fn();
      if (value) return value;
      await this.sleep(step);
    }
    return null;
  },
  resultLinkCount() {
    return document.querySelectorAll('a[href*="/edit/"]').length;
  },
  anyProgressVisible() {
    return /\\b\\d{1,3}%/.test(document.body.innerText || '');
  },
  generatedImageUrls() {
    return [...document.querySelectorAll('img')]
      .filter((image) => /getMediaUrlRedirect/.test(image.src) || /dihasilkan/i.test(image.alt || ''))
      .map((image) => image.currentSrc || image.src)
      .filter((value, index, array) => value && array.indexOf(value) === index);
  },
  isVariationText(text, variations) {
    const normalized = String(text || '').trim().toLowerCase();
    return normalized === 'x' + variations || normalized === variations + 'x';
  }
};
true;
`

export const DOWNLOAD_HELPERS = `
window.__flowDl = {
  generatedImageUrls() {
    return [...document.querySelectorAll('img')]
      .filter((image) => /getMediaUrlRedirect/.test(image.src) || /dihasilkan/i.test(image.alt || ''))
      .map((image) => image.currentSrc || image.src)
      .filter((value, index, array) => value && array.indexOf(value) === index);
  },
  async fetchAsBase64(url) {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error('fetch ' + response.status + ' for ' + url);
    const mime = response.headers.get('content-type') || 'image/png';
    const buffer = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < buffer.length; index += chunk) {
      binary += String.fromCharCode.apply(null, buffer.subarray(index, index + chunk));
    }
    return { b64: btoa(binary), mime };
  }
};
true;
`

export function normalizeFlowGenerateInput(input: FlowGenerateInput): NormalizedFlowGenerateInput {
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error('Pass a prompt for Flow generation.')

  const ratio = input.ratio ?? '1:1'
  if (!isFlowGenerateRatio(ratio)) throw new Error(`Unsupported ratio "${ratio}".`)

  const variations = input.variations ?? 4
  if (!isFlowGenerateVariations(variations)) throw new Error(`Unsupported variations "${variations}". Use 1, 2, 3, or 4.`)

  return {
    chromeOrigin: normalizeChromeOrigin(input.chromeOrigin ?? `http://127.0.0.1:${defaultPortFor('flow')}`),
    prompt,
    ratio,
    variations,
    model: input.model?.trim() || 'Nano Banana Pro',
    tabUrlIncludes: input.tabUrlIncludes?.trim() || DEFAULT_FLOW_TAB_URL_PART,
    generateTimeoutMs: normalizePositiveInteger(input.generateTimeoutMs, 120000),
    downloadDir: input.downloadDir?.trim() || undefined,
    downloadFilePrefix: input.downloadFilePrefix?.trim() || undefined,
    fetchImpl: input.fetchImpl,
    connectSession: input.connectSession ?? connectCdpSession
  }
}

export async function ensureFlowChrome(input: EnsureFlowChromeInput = {}): Promise<string> {
  const launch = input.launchChrome ?? launchChrome
  const launchInput: LaunchChromeInput = {
    url: input.url,
    profile: input.profile ?? 'flow'
  }
  if (input.profileDir) launchInput.profileDir = input.profileDir
  if (input.remoteDebuggingPort) launchInput.remoteDebuggingPort = input.remoteDebuggingPort
  if (input.chromePath) launchInput.chromePath = input.chromePath
  if (typeof input.headless === 'boolean') launchInput.headless = input.headless
  if (input.forceHeadless) launchInput.forceHeadless = true
  const result = await launch(launchInput)
  return `http://127.0.0.1:${result.remoteDebuggingPort}`
}

export async function openFlowUrl(input: {
  chromeOrigin: string
  url: string
  fetchImpl?: typeof fetch
}): Promise<void> {
  const chromeOrigin = normalizeChromeOrigin(input.chromeOrigin)
  const targetUrl = new URL(`/json/new?${encodeURIComponent(input.url)}`, chromeOrigin)
  const response = await (input.fetchImpl ?? fetch)(targetUrl, { method: 'PUT' })
  if (!response.ok) {
    throw new Error(`Failed to open Flow URL in Chrome. Chrome /json/new returned ${response.status}.`)
  }
}

export async function findFlowTarget(input: {
  chromeOrigin: string
  tabUrlIncludes: string
  fetchImpl?: typeof fetch
}): Promise<ChromeTarget> {
  let targets: ChromeTarget[]
  try {
    targets = await listChromeTargets({
      chromeOrigin: input.chromeOrigin,
      fetchImpl: input.fetchImpl
    })
  } catch (error) {
    throw new Error(
      `Flow Chrome is not reachable at ${input.chromeOrigin}. Run: research-crawler open-chrome --profile flow --url "https://labs.google/fx/id/tools/flow/project/<project-id>", log in, then retry flow-generate.`,
      { cause: error }
    )
  }
  const target = targets.find((candidate) => (
    candidate.type === 'page' &&
    Boolean(candidate.webSocketDebuggerUrl) &&
    candidate.url.includes(input.tabUrlIncludes)
  ))
  if (!target) {
    throw new Error(`No Flow tab found matching "${input.tabUrlIncludes}". Open a Flow project tab in Chrome first.`)
  }
  return target
}

export async function flowGenerate(input: FlowGenerateInput): Promise<FlowGenerateResult> {
  const normalized = normalizeFlowGenerateInput(input)
  const target = await findFlowTarget(normalized)
  if (!target.webSocketDebuggerUrl) {
    throw new Error('Flow tab did not expose a CDP socket.')
  }

  const session = await normalized.connectSession(target.webSocketDebuggerUrl)
  try {
    await session.send('Runtime.enable')
    await session.send('Page.enable')
    await evaluate(session, FLOW_HELPERS)

    const focused = await evaluate<boolean>(session, `(async () => {
      const el = await __flow.waitFor(() => __flow.promptEl());
      if (!el) return false;
      el.focus();
      const sel = window.getSelection();
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.addRange(range);
      document.execCommand('delete', false);
      return true;
    })()`)
    if (!focused) throw new Error('Prompt editor not found.')

    await session.send('Input.insertText', { text: normalized.prompt })
    await evaluate(session, '__flow.sleep(150)')

    await ensureSettingsOpen(session)

    await clickElement(
      session,
      `__flow.ratioButton(${JSON.stringify(RATIO_ICON[normalized.ratio])}, ${JSON.stringify(normalized.ratio)})`,
      `ratio button ${normalized.ratio} not found`
    )
    await evaluate(session, '__flow.sleep(200)')

    await clickElement(
      session,
      `__flow.variationButton(${normalized.variations})`,
      `variation x${normalized.variations} not found`
    )
    await evaluate(session, '__flow.sleep(200)')

    await clickElement(session, `__flow.modelDropdownButton()`, 'model dropdown trigger not found')
    await evaluate(session, '__flow.sleep(350)')
    await clickElement(
      session,
      `[...document.querySelectorAll('button, [role="option"], li')]
        .find((item) => (item.innerText || '').trim().replace(/^🍌\\s*/, '') === ${JSON.stringify(normalized.model)})`,
      `model option ${normalized.model} not found`
    )
    await evaluate(session, '__flow.sleep(300)')

    const beforeResultLinks = await evaluate<number>(session, '__flow.resultLinkCount()')
    const beforeImageUrls = await evaluate<number>(session, '__flow.generatedImageUrls().length')

    await clickElement(session, `__flow.btnByIcon('arrow_forward')`, 'submit button not found')

    await waitForGeneration(session, {
      beforeResultLinks,
      beforeImageUrls,
      variations: normalized.variations,
      timeoutMs: normalized.generateTimeoutMs
    })

    const resultEditUrls = await evaluate<string[]>(session, `
      [...document.querySelectorAll('a[href*="/edit/"]')].map((anchor) => anchor.href).slice(0, ${normalized.variations})
    `)
    const downloadedImagePaths = normalized.downloadDir
      ? await downloadGeneratedImagesFromSession(session, {
          downloadDir: normalized.downloadDir,
          count: normalized.variations,
          filePrefix: normalized.downloadFilePrefix ?? slugify(normalized.prompt)
        })
      : undefined

    return {
      ok: true,
      chromeOrigin: normalized.chromeOrigin,
      tabUrl: target.url,
      prompt: normalized.prompt,
      ratio: normalized.ratio,
      variations: normalized.variations,
      model: normalized.model,
      resultEditUrls,
      ...(downloadedImagePaths ? { downloadedImagePaths } : {})
    }
  } finally {
    session.close()
  }
}

export async function downloadGeneratedImages(
  cdp: FlowEvalSession,
  opts: { downloadDir: string; count: number; filePrefix?: string }
): Promise<string[]> {
  const { downloadDir, count } = opts
  const prefix = opts.filePrefix ?? 'image'

  await cdp.eval(DOWNLOAD_HELPERS)
  await mkdir(downloadDir, { recursive: true })

  const urls = await cdp.eval<string[]>(`__flowDl.generatedImageUrls().slice(-${count})`)
  if (urls.length < count) {
    throw new Error(`Expected ${count} generated image URL(s), found ${urls.length}.`)
  }

  const saved: string[] = []
  for (let index = 0; index < urls.length; index += 1) {
    const { b64, mime } = await cdp.eval<{ b64: string; mime: string }>(
      `__flowDl.fetchAsBase64(${JSON.stringify(urls[index])})`
    )
    const filename = `${prefix}_${String(index + 1).padStart(2, '0')}.${extensionForMime(mime)}`
    const filepath = join(downloadDir, filename)
    await writeFile(filepath, Buffer.from(b64, 'base64'))
    saved.push(filepath)
  }
  return saved
}

export async function downloadGeneratedImagesFromSession(
  session: CdpSession,
  opts: { downloadDir: string; count: number; filePrefix?: string }
): Promise<string[]> {
  const urls = await evaluate<string[]>(session, `
    [...document.querySelectorAll('img')]
      .filter((image) => /getMediaUrlRedirect/.test(image.src) || /dihasilkan/i.test(image.alt || ''))
      .map((image) => image.currentSrc || image.src)
      .filter((value, index, array) => value && array.indexOf(value) === index)
      .slice(0, ${opts.count})
  `)
  if (urls.length < opts.count) {
    throw new Error(`Expected ${opts.count} generated image URL(s), found ${urls.length}.`)
  }

  await session.send('Network.enable')
  const cookiePayload = await session.send<{ cookies?: Array<{ name?: unknown; value?: unknown }> }>('Network.getCookies', {
    urls: ['https://labs.google/', ...urls]
  })
  const cookie = formatCookieHeader(cookiePayload.cookies ?? [])

  await mkdir(opts.downloadDir, { recursive: true })
  const prefix = opts.filePrefix ?? 'image'
  const saved: string[] = []
  for (let index = 0; index < urls.length; index += 1) {
    const response = await fetch(urls[index], {
      headers: {
        cookie,
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'user-agent': 'Mozilla/5.0'
      }
    })
    if (!response.ok) throw new Error(`fetch ${response.status} for ${urls[index]}`)
    const mime = response.headers.get('content-type') || 'image/png'
    const filename = `${prefix}_${String(index + 1).padStart(2, '0')}.${extensionForMime(mime)}`
    const filepath = join(opts.downloadDir, filename)
    await writeFile(filepath, Buffer.from(await response.arrayBuffer()))
    saved.push(filepath)
  }
  return saved
}

export function isFlowVariationText(text: string, variations: FlowGenerateVariations): boolean {
  const normalized = text.trim().toLowerCase()
  return normalized === `x${variations}` || normalized === `${variations}x`
}

export function formatCookieHeader(cookies: Array<{ name?: unknown; value?: unknown }>): string {
  return cookies
    .filter((cookie) => typeof cookie.name === 'string' && typeof cookie.value === 'string')
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ')
}

async function waitForGeneration(
  session: CdpSession,
  input: {
    beforeResultLinks: number
    beforeImageUrls: number
    variations: FlowGenerateVariations
    timeoutMs: number
  }
): Promise<void> {
  const deadline = Date.now() + input.timeoutMs
  while (Date.now() < deadline) {
    const [resultLinks, imageUrls, progressing] = await Promise.all([
      evaluate<number>(session, '__flow.resultLinkCount()'),
      evaluate<number>(session, '__flow.generatedImageUrls().length'),
      evaluate<boolean>(session, '__flow.anyProgressVisible()')
    ])
    if (shouldTreatGenerationAsComplete({
      beforeResultLinks: input.beforeResultLinks,
      resultLinks,
      beforeImageUrls: input.beforeImageUrls,
      imageUrls,
      variations: input.variations,
      progressing
    })) return
    await delay(1500)
  }
  throw new Error(`Generation did not complete within ${input.timeoutMs}ms.`)
}

export function shouldTreatGenerationAsComplete(input: {
  beforeResultLinks: number
  resultLinks: number
  beforeImageUrls: number
  imageUrls: number
  variations: FlowGenerateVariations
  progressing: boolean
}): boolean {
  if (input.progressing) return false
  return input.resultLinks >= input.beforeResultLinks + input.variations ||
    input.imageUrls >= input.beforeImageUrls + input.variations
}

async function evaluate<T = unknown>(session: CdpSession, expression: string): Promise<T> {
  const response = await session.send<{
    result?: { value?: unknown }
    exceptionDetails?: { exception?: { description?: string }; text?: string }
  }>('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Runtime.evaluate failed.')
  }
  return response.result?.value as T
}

async function clickElement(session: CdpSession, expression: string, errorMessage: string): Promise<void> {
  const rect = await evaluate<{ x: number; y: number; width: number; height: number } | null>(session, `(async () => {
    const el = await __flow.waitFor(() => (${expression}));
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`)
  if (!rect || rect.width <= 0 || rect.height <= 0) throw new Error(errorMessage)
  const x = rect.x + rect.width / 2
  const y = rect.y + rect.height / 2
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
  await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

async function ensureSettingsOpen(session: CdpSession): Promise<void> {
  const alreadyOpen = await evaluate<boolean>(session, '__flow.settingsOpen()')
  if (alreadyOpen) return
  await clickElement(session, '__flow.settingsButton()', 'model settings button missing')
  await evaluate(session, `(async () => {
    const opened = await __flow.waitFor(() => __flow.settingsOpen(), 4000);
    if (!opened) throw new Error('model settings popover did not open');
    return true;
  })()`)
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !value || value <= 0) return fallback
  return Math.floor(value)
}

function isFlowGenerateRatio(value: unknown): value is FlowGenerateRatio {
  return value === '16:9' || value === '4:3' || value === '1:1' || value === '3:4' || value === '9:16'
}

function isFlowGenerateVariations(value: unknown): value is FlowGenerateVariations {
  return value === 1 || value === 2 || value === 3 || value === 4
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'image'
}

function extensionForMime(mime: string): string {
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  return 'png'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
