import { join, resolve, basename } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { TypedEmitter } from '../../events/stream.js'
import type { AgentEventMap } from '../../events/stream.js'
import { getDataDir } from '../data-dir.js'
import { sendChatGPTPrompt } from '@anubis/research-crawler'

export interface GptWebRunOpts {
  workspaceId: string
  sessionId?: string
  conversationId?: string
  cwd: string
  prompt: string
  model?: string
  extraEnv?: Record<string, string>
  appendSystemPrompt?: string
  files?: string[]
}

function buildFinalPrompt(
  prompt: string,
  appendSystemPrompt?: string,
  files?: string[],
): string {
  const parts: string[] = []

  if (appendSystemPrompt?.trim()) {
    parts.push(`<system-context>\n${appendSystemPrompt.trim()}\n</system-context>`)
  }

  if (files?.length) {
    const fileBlocks: string[] = []
    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, 'utf8')
        const name = basename(filePath)
        fileBlocks.push(`<file name="${name}">\n${content}\n</file>`)
      } catch {
        // skip unreadable files silently
      }
    }
    if (fileBlocks.length) parts.push(fileBlocks.join('\n\n'))
  }

  parts.push(prompt)
  return parts.join('\n\n')
}

const PROFILE_DIRS = {
  login: 'chrome-profile-login',
  public: 'chrome-profile-public',
  flow: 'chrome-profile-flow',
}

const LEGACY_LOGIN_PROFILE_DIR = 'chrome-profile'

function getAppConfig(): any {
  const path = join(getDataDir(), 'config.json')
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

function resolveCrawlerProfileDir(
  rawRoot: string | undefined,
  profile: 'login' | 'public' | 'flow',
): string | undefined {
  const root = rawRoot?.trim()
  if (!root) return undefined

  const absolute = resolve(root)
  const wanted = PROFILE_DIRS[profile]
  const absoluteBasename = basename(absolute).toLowerCase()
  if (
    absoluteBasename === wanted.toLowerCase()
    || (profile === 'login' && absoluteBasename === LEGACY_LOGIN_PROFILE_DIR)
  ) {
    return absolute
  }

  const directFromData = resolve(join(absolute, wanted))
  if (existsSync(directFromData) || basename(absolute).toLowerCase() === 'data') {
    return directFromData
  }

  const nestedFromProject = resolve(join(absolute, 'data', wanted))
  return nestedFromProject
}

function withCrawlerProfileDefaults(
  input: any,
  profile: 'login' | 'public' | 'flow',
  config: any,
  appDataDir?: string,
): any {
  if (input.profileDir?.trim()) return input
  const profileDir = appDataDir
    ? resolve(join(appDataDir, 'chrome-profiles', PROFILE_DIRS[profile]))
    : resolveCrawlerProfileDir(config.crawlerProfileRoot, profile)
  return profileDir ? { ...input, profileDir } : input
}

export class GptWebAgent {
  async run(
    opts: GptWebRunOpts,
  ): Promise<{ emitter: TypedEmitter<AgentEventMap>; cancel: () => void }> {
    const emitter = new TypedEmitter<AgentEventMap>()
    const abortController = new AbortController()

    let lastText = ''
    const onDelta = (text: string) => {
      const delta = text.slice(lastText.length)
      if (delta) {
        emitter.emit('partial', { deltaText: delta })
        lastText = text
      }
    }

    const appDataDir = getDataDir()
    const config = getAppConfig()

    // We run ChatGPT using the 'login' profile
    const crawlerInput = withCrawlerProfileDefaults(
      {
        prompt: buildFinalPrompt(opts.prompt, opts.appendSystemPrompt, opts.files),
        conversationId: opts.conversationId,
        chromePath: config.chromePath,
        onDelta,
        signal: abortController.signal,
      },
      'login',
      config,
      appDataDir,
    )

    let cancelled = false
    const cancel = () => {
      if (cancelled) return
      cancelled = true
      abortController.abort()
      emitter.emit('done', { finishReason: 'cancelled' })
    }

    // Run in the background
    Promise.resolve().then(async () => {
      try {
        const result = await sendChatGPTPrompt(crawlerInput)

        if (cancelled) return

        if (!result.ok) {
          const errMsg = (result as any).error?.message ?? 'ChatGPT web prompt failed'
          emitter.emit('error', { error: new Error(errMsg) })
          return
        }

        if (result.input?.conversationId) {
          emitter.emit('session', { sessionId: result.input.conversationId })
        }

        // Find the last assistant message and ensure the final text is fully emitted/synchronized
        const messages = (result as any).messages || []
        const lastMsg = messages.filter((m: any) => m.role === 'assistant').pop()
        if (lastMsg && lastMsg.content) {
          const finalFullText = lastMsg.content
          const finalDelta = finalFullText.slice(lastText.length)
          if (finalDelta) {
            emitter.emit('partial', { deltaText: finalDelta })
          }
        }

        emitter.emit('done', {
          finishReason: 'stop',
          usage: result,
        })
      } catch (err: any) {
        if (cancelled) return
        emitter.emit('error', { error: err instanceof Error ? err : new Error(String(err)) })
      }
    })

    return { emitter, cancel }
  }
}
