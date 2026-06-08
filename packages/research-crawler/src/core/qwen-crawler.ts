import { silentReporter, type ProgressReporter } from './progress/progress-reporter.js'
import { createQwenCdpCaptureService } from './services/qwen-cdp-capture.service.js'
import {
  standardizeQwenResult,
  standardizeQwenDetailsResult,
  standardizeQwenPromptResult,
  type StandardCrawlerOutput
} from './standard-output.js'
import { launchChrome, killChrome } from './chrome/launch-chrome.js'
import { defaultPortFor, type ProfileName } from './chrome/profile-resolver.js'

const QWEN_HOME = 'https://chat.qwen.ai/'

export type CaptureQwenConversationsInput = {
  chromeOrigin?: string
  remoteDebuggingPort?: number
  timeoutMs?: number
  reporter?: ProgressReporter
  openNewTab?: boolean
  profile?: ProfileName
  profileDir?: string
  profileDirectory?: string
  chromePath?: string
  headless?: boolean
  forceHeadless?: boolean
  keepChromeOpen?: boolean
  keepTabOpen?: boolean
  includeRaw?: boolean
}

export type CaptureQwenConversationDetailsInput = CaptureQwenConversationsInput & {
  conversationId: string
}

export type SendQwenPromptInput = CaptureQwenConversationsInput & {
  prompt: string
  conversationId?: string
  /** Called with the full assistant text so far as it streams in from the page. */
  onDelta?: (text: string) => void
  signal?: AbortSignal
}

function resolvePort(input: { remoteDebuggingPort?: number; chromeOrigin?: string; profile?: ProfileName }): { port: number; profile: ProfileName } {
  let port = input.remoteDebuggingPort
  if (!port && input.chromeOrigin) {
    try {
      const url = new URL(input.chromeOrigin.trim())
      const parsedPort = Number(url.port)
      if (parsedPort > 0) port = parsedPort
    } catch {}
  }
  const profile: ProfileName = input.profile ?? 'login'
  if (!port) port = defaultPortFor(profile)
  return { port, profile }
}

function launchOpts(input: CaptureQwenConversationsInput, port: number, profile: ProfileName, url: string) {
  return {
    remoteDebuggingPort: port,
    profile,
    url,
    ...(input.profileDir ? { profileDir: input.profileDir } : {}),
    ...(input.profileDirectory ? { profileDirectory: input.profileDirectory } : {}),
    ...(input.chromePath ? { chromePath: input.chromePath } : {}),
    ...(typeof input.headless === 'boolean' ? { headless: input.headless } : {}),
    ...(input.forceHeadless ? { forceHeadless: true } : {})
  }
}

export async function captureQwenConversations(input: CaptureQwenConversationsInput = {}): Promise<StandardCrawlerOutput> {
  const { port, profile } = resolvePort(input)
  const launchResult = await launchChrome(launchOpts(input, port, profile, QWEN_HOME))

  const service = createQwenCdpCaptureService()
  const chromeOrigin = input.chromeOrigin?.trim() || `http://127.0.0.1:${port}`
  const reporter = input.reporter ?? silentReporter()

  const normalizedInput = {
    target: 'qwen' as const,
    mode: 'conversation_list' as const,
    chromeOrigin,
    ...(input.remoteDebuggingPort ? { remoteDebuggingPort: input.remoteDebuggingPort } : {}),
    ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.includeRaw ? { includeRaw: true } : {})
  }

  const result = await service.capture({
    chromeOrigin,
    timeoutMs: input.timeoutMs,
    openNewTab: input.openNewTab ?? false,
    keepTabOpen: input.keepTabOpen ?? true,
    reporter
  })

  const output = standardizeQwenResult(normalizedInput, result)
  if (!launchResult.reused && input.keepChromeOpen === false) {
    await killChrome(port)
  }
  return output
}

export async function captureQwenConversationDetails(input: CaptureQwenConversationDetailsInput): Promise<StandardCrawlerOutput> {
  const { port, profile } = resolvePort(input)
  const launchResult = await launchChrome(launchOpts(input, port, profile, `${QWEN_HOME}c/${input.conversationId}`))

  const service = createQwenCdpCaptureService()
  const chromeOrigin = input.chromeOrigin?.trim() || `http://127.0.0.1:${port}`
  const reporter = input.reporter ?? silentReporter()

  const normalizedInput = {
    target: 'qwen' as const,
    mode: 'conversation_details' as const,
    chromeOrigin,
    conversationId: input.conversationId,
    ...(input.remoteDebuggingPort ? { remoteDebuggingPort: input.remoteDebuggingPort } : {}),
    ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.includeRaw ? { includeRaw: true } : {})
  }

  const result = await service.captureDetails({
    chromeOrigin,
    conversationId: input.conversationId,
    timeoutMs: input.timeoutMs,
    openNewTab: input.openNewTab ?? false,
    keepTabOpen: input.keepTabOpen ?? true,
    reporter
  })

  const output = standardizeQwenDetailsResult(normalizedInput, result)
  if (!launchResult.reused && input.keepChromeOpen === false) {
    await killChrome(port)
  }
  return output
}

export async function sendQwenPrompt(input: SendQwenPromptInput): Promise<StandardCrawlerOutput> {
  const { port, profile } = resolvePort(input)
  const initialUrl = input.conversationId ? `${QWEN_HOME}c/${input.conversationId}` : QWEN_HOME
  const launchResult = await launchChrome(launchOpts(input, port, profile, initialUrl))

  const service = createQwenCdpCaptureService()
  const chromeOrigin = input.chromeOrigin?.trim() || `http://127.0.0.1:${port}`
  const reporter = input.reporter ?? silentReporter()

  const normalizedInput = {
    target: 'qwen' as const,
    mode: 'send_prompt' as const,
    chromeOrigin,
    prompt: input.prompt,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.remoteDebuggingPort ? { remoteDebuggingPort: input.remoteDebuggingPort } : {}),
    ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.includeRaw ? { includeRaw: true } : {})
  }

  const result = await service.sendPrompt({
    chromeOrigin,
    prompt: input.prompt,
    conversationId: input.conversationId,
    timeoutMs: input.timeoutMs,
    openNewTab: input.openNewTab ?? false,
    keepTabOpen: input.keepTabOpen ?? true,
    ...(input.onDelta ? { onDelta: input.onDelta } : {}),
    signal: input.signal,
    reporter
  })

  const output = standardizeQwenPromptResult(normalizedInput, result)
  if (!launchResult.reused && input.keepChromeOpen === false) {
    await killChrome(port)
  }
  return output
}
