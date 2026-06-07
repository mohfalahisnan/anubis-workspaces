import { silentReporter, type ProgressReporter } from './progress/progress-reporter.js'
import { createChatGPTCdpCaptureService } from './services/chatgpt-cdp-capture.service.js'
import {
  standardizeChatGPTResult,
  standardizeChatGPTDetailsResult,
  standardizeChatGPTPromptResult,
  type StandardCrawlerOutput
} from './standard-output.js'
import { launchChrome, killChrome } from './chrome/launch-chrome.js'
import { defaultPortFor, type ProfileName } from './chrome/profile-resolver.js'

export type CaptureChatGPTConversationsInput = {
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

export type CaptureChatGPTConversationDetailsInput = {
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
  conversationId: string
}

export type SendChatGPTPromptInput = {
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
  prompt: string
  conversationId?: string
  /** Called with the full assistant text so far as it streams in from the page. */
  onDelta?: (text: string) => void
}

export async function captureChatGPTConversations(input: CaptureChatGPTConversationsInput = {}): Promise<StandardCrawlerOutput> {
  let port = input.remoteDebuggingPort
  if (!port && input.chromeOrigin) {
    try {
      const url = new URL(input.chromeOrigin.trim())
      const parsedPort = Number(url.port)
      if (parsedPort > 0) port = parsedPort
    } catch {}
  }
  const explicitProfile = input.profile
  const profile: ProfileName = explicitProfile ?? 'login'
  if (!port) port = defaultPortFor(profile)

  const launchResult = await launchChrome({
    remoteDebuggingPort: port,
    profile,
    url: 'https://chatgpt.com/',
    ...(input.profileDir ? { profileDir: input.profileDir } : {}),
    ...(input.profileDirectory ? { profileDirectory: input.profileDirectory } : {}),
    ...(input.chromePath ? { chromePath: input.chromePath } : {}),
    ...(typeof input.headless === 'boolean' ? { headless: input.headless } : {}),
    ...(input.forceHeadless ? { forceHeadless: true } : {})
  })

  const service = createChatGPTCdpCaptureService()
  const chromeOrigin = input.chromeOrigin?.trim() || `http://127.0.0.1:${port}`
  const reporter = input.reporter ?? silentReporter()

  const normalizedInput = {
    target: 'chatgpt' as const,
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

  const output = standardizeChatGPTResult(normalizedInput, result)
  if (!launchResult.reused && input.keepChromeOpen === false) {
    await killChrome(port)
  }
  return output
}

export async function captureChatGPTConversationDetails(input: CaptureChatGPTConversationDetailsInput): Promise<StandardCrawlerOutput> {
  let port = input.remoteDebuggingPort
  if (!port && input.chromeOrigin) {
    try {
      const url = new URL(input.chromeOrigin.trim())
      const parsedPort = Number(url.port)
      if (parsedPort > 0) port = parsedPort
    } catch {}
  }
  const explicitProfile = input.profile
  const profile: ProfileName = explicitProfile ?? 'login'
  if (!port) port = defaultPortFor(profile)

  const launchResult = await launchChrome({
    remoteDebuggingPort: port,
    profile,
    url: `https://chatgpt.com/c/${input.conversationId}`,
    ...(input.profileDir ? { profileDir: input.profileDir } : {}),
    ...(input.profileDirectory ? { profileDirectory: input.profileDirectory } : {}),
    ...(input.chromePath ? { chromePath: input.chromePath } : {}),
    ...(typeof input.headless === 'boolean' ? { headless: input.headless } : {}),
    ...(input.forceHeadless ? { forceHeadless: true } : {})
  })

  const service = createChatGPTCdpCaptureService()
  const chromeOrigin = input.chromeOrigin?.trim() || `http://127.0.0.1:${port}`
  const reporter = input.reporter ?? silentReporter()

  const normalizedInput = {
    target: 'chatgpt' as const,
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

  const output = standardizeChatGPTDetailsResult(normalizedInput, result)
  if (!launchResult.reused && input.keepChromeOpen === false) {
    await killChrome(port)
  }
  return output
}

export async function sendChatGPTPrompt(input: SendChatGPTPromptInput): Promise<StandardCrawlerOutput> {
  let port = input.remoteDebuggingPort
  if (!port && input.chromeOrigin) {
    try {
      const url = new URL(input.chromeOrigin.trim())
      const parsedPort = Number(url.port)
      if (parsedPort > 0) port = parsedPort
    } catch {}
  }
  const explicitProfile = input.profile
  const profile: ProfileName = explicitProfile ?? 'login'
  if (!port) port = defaultPortFor(profile)

  const initialUrl = input.conversationId ? `https://chatgpt.com/c/${input.conversationId}` : 'https://chatgpt.com/'
  const launchResult = await launchChrome({
    remoteDebuggingPort: port,
    profile,
    url: initialUrl,
    ...(input.profileDir ? { profileDir: input.profileDir } : {}),
    ...(input.profileDirectory ? { profileDirectory: input.profileDirectory } : {}),
    ...(input.chromePath ? { chromePath: input.chromePath } : {}),
    ...(typeof input.headless === 'boolean' ? { headless: input.headless } : {}),
    ...(input.forceHeadless ? { forceHeadless: true } : {})
  })

  const service = createChatGPTCdpCaptureService()
  const chromeOrigin = input.chromeOrigin?.trim() || `http://127.0.0.1:${port}`
  const reporter = input.reporter ?? silentReporter()

  const normalizedInput = {
    target: 'chatgpt' as const,
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
    reporter
  })

  const output = standardizeChatGPTPromptResult(normalizedInput, result)
  if (!launchResult.reused && input.keepChromeOpen === false) {
    await killChrome(port)
  }
  return output
}
