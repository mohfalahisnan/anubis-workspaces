#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { connectCdpSession } from './core/chrome/cdp-session.js'
import { launchChrome } from './core/chrome/launch-chrome.js'
import { defaultPortFor, type ProfileName } from './core/chrome/profile-resolver.js'
import { downloadGeneratedImagesFromSession, ensureFlowChrome, findFlowTarget, flowGenerate, openFlowUrl, type FlowGenerateRatio, type FlowGenerateVariations } from './core/flow/flow-generate.js'
import { applyAvgLikesToOutput } from './core/instagram/avg-likes.js'
import { captureInstagramData, discoverInstagramCompetitors } from './core/instagram-crawler.js'
import { silentReporter, stderrReporter, type ProgressReporter } from './core/progress/progress-reporter.js'
import type { StandardCrawlerOutput } from './core/standard-output.js'

type ParsedArgs = {
  command: string
  values: Map<string, string | true>
  positionals: string[]
}

async function main(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp()
    return
  }

  const args = parseArgs(argv)
  if (args.values.has('help') || args.values.has('h')) {
    printHelp()
    return
  }

  if (args.command === 'open-chrome') {
    await writeOutput(args, await launchChrome({
      url: readOptionalString(args, 'url'),
      profile: readProfile(args, 'login'),
      profileDir: readOptionalString(args, 'profile-dir'),
      remoteDebuggingPort: readNumber(args, 'remote-debugging-port'),
      chromePath: readOptionalString(args, 'chrome-path'),
      ...resolveHeadlessFlag(args),
      forceHeadless: args.values.has('force-headless')
    }))
    return
  }

  if (args.command === 'flow-generate') {
    const flowUrl = readOptionalString(args, 'url')
    const chromeOrigin = readOptionalString(args, 'chrome-origin') ?? await ensureFlowChrome({
      url: flowUrl ? 'about:blank' : 'https://labs.google/fx/id/tools/flow',
      profile: readProfile(args, 'flow'),
      profileDir: readOptionalString(args, 'profile-dir'),
      remoteDebuggingPort: readNumber(args, 'remote-debugging-port') ?? readNumber(args, 'port'),
      chromePath: readOptionalString(args, 'chrome-path'),
      ...resolveHeadlessFlag(args),
      forceHeadless: args.values.has('force-headless')
    })
    if (flowUrl && !readOptionalString(args, 'chrome-origin')) {
      await openFlowUrl({ chromeOrigin, url: flowUrl })
    }
    await writeOutput(args, await flowGenerate({
      chromeOrigin,
      prompt: resolveFlowPrompt(args),
      ratio: readFlowRatio(args),
      variations: readFlowVariations(args),
      model: readOptionalString(args, 'model'),
      tabUrlIncludes: readOptionalString(args, 'tab-url-includes'),
      generateTimeoutMs: readNumber(args, 'generate-timeout-ms') ?? readNumber(args, 'timeout-ms'),
      downloadDir: readOptionalString(args, 'download-dir'),
      downloadFilePrefix: readOptionalString(args, 'download-file-prefix')
    }))
    return
  }

  if (args.command === 'flow-download') {
    const chromeOrigin = readOptionalString(args, 'chrome-origin') ?? await ensureFlowChrome({
      url: readOptionalString(args, 'url') ?? 'https://labs.google/fx/id/tools/flow',
      profile: readProfile(args, 'flow'),
      profileDir: readOptionalString(args, 'profile-dir'),
      remoteDebuggingPort: readNumber(args, 'remote-debugging-port') ?? readNumber(args, 'port'),
      chromePath: readOptionalString(args, 'chrome-path'),
      ...resolveHeadlessFlag(args),
      forceHeadless: args.values.has('force-headless')
    })
    const target = await findFlowTargetForDownload(args, chromeOrigin)
    const session = await connectCdpSession(target.webSocketDebuggerUrl!)
    try {
      const saved = await downloadGeneratedImagesFromSession(session, {
        downloadDir: readOptionalString(args, 'download-dir') ?? 'result/flow',
        count: readNumber(args, 'count') ?? readFlowVariations(args) ?? 4,
        filePrefix: readOptionalString(args, 'download-file-prefix') ?? 'flow'
      })
      await writeOutput(args, { ok: true, downloadedImagePaths: saved })
    } finally {
      session.close()
    }
    return
  }

  if (args.command === 'capture-instagram-profile') {
    const reporter = resolveReporter(args)
    const usernames = await resolveUsernames(args)
    const minPosts = readNumber(args, 'min-posts')
    if (usernames.length > 0) {
      const postsPerProfile = readNumber(args, 'posts-per-profile') ?? readNumber(args, 'max-responses') ?? 30
      const aggregated = await captureManyUsernames({
        usernames,
        postsPerProfile,
        args,
        reporter
      })
      await writeOutput(args, simplifyCaptureOutput(applyAvgLikesToOutput(aggregated, { minPosts })))
      return
    }
    const postsPerProfile = readNumber(args, 'posts-per-profile') ?? readNumber(args, 'max-responses')
    const captured = await captureInstagramData({
      username: readOptionalString(args, 'username'),
      url: readOptionalString(args, 'url'),
      chromeOrigin: readOptionalString(args, 'chrome-origin'),
      remoteDebuggingPort: readNumber(args, 'remote-debugging-port'),
      ...(postsPerProfile ? { maxResponses: postsPerProfile } : {}),
      timeoutMs: readNumber(args, 'timeout-ms'),
      includeRaw: args.values.has('include-raw'),
      profile: readOptionalProfile(args),
      profileDir: readOptionalString(args, 'profile-dir'),
      chromePath: readOptionalString(args, 'chrome-path'),
      ...resolveHeadlessFlag(args),
      ...(args.values.has('force-headless') ? { forceHeadless: true } : {}),
      ...(args.values.has('keep-chrome-open') ? { keepChromeOpen: true } : {}),
      ...(args.values.has('open-new-tab') ? { openNewTab: true } : {}),
      ...(args.values.has('keep-tab-open') ? { keepTabOpen: true } : {}),
      reporter
    })
    await writeOutput(args, simplifyCaptureOutput(applyAvgLikesToOutput(captured, { minPosts })))
    return
  }

  if (args.command === 'capture-instagram-post') {
    const reporter = resolveReporter(args)
    const postUrl = readOptionalString(args, 'post-url') ?? readOptionalString(args, 'url')
    if (!postUrl) {
      throw new Error('Pass --post-url <instagram permalink>.')
    }
    await writeOutput(args, await captureInstagramData({
      url: postUrl,
      chromeOrigin: readOptionalString(args, 'chrome-origin'),
      remoteDebuggingPort: readNumber(args, 'remote-debugging-port'),
      maxResponses: readNumber(args, 'posts-per-profile') ?? 1,
      timeoutMs: readNumber(args, 'timeout-ms'),
      includeRaw: args.values.has('include-raw'),
      profile: readOptionalProfile(args),
      profileDir: readOptionalString(args, 'profile-dir'),
      chromePath: readOptionalString(args, 'chrome-path'),
      ...resolveHeadlessFlag(args),
      ...(args.values.has('force-headless') ? { forceHeadless: true } : {}),
      ...(args.values.has('keep-chrome-open') ? { keepChromeOpen: true } : {}),
      ...(args.values.has('open-new-tab') ? { openNewTab: true } : {}),
      ...(args.values.has('keep-tab-open') ? { keepTabOpen: true } : {}),
      reporter
    }))
    return
  }

  if (args.command === 'setup-avg-likes') {
    const reporter = resolveReporter(args)
    const usernames = await resolveProfileUsernames(args)
    if (usernames.length === 0) throw new Error('Pass --username, --usernames, or --from-file.')

    const postsPerProfile = Math.max(20, readNumber(args, 'posts-per-profile') ?? readNumber(args, 'max-responses') ?? 20)
    const minPosts = readNumber(args, 'min-posts') ?? 20
    const captured = await captureManyUsernames({
      usernames,
      postsPerProfile,
      minPosts,
      mode: 'avg_likes_setup',
      args,
      reporter
    })

    await writeOutput(args, simplifyAvgLikesOutput(applyAvgLikesToOutput(captured, { minPosts })))
    return
  }

  if (args.command === 'discover-instagram') {
    const reporter = resolveReporter(args)
    const rawSource = readOptionalString(args, 'source')
    const source = rawSource === 'hashtag' ? 'hashtag' : rawSource === 'keyword' ? 'keyword' : 'explore'
    const discovered = await discoverInstagramCompetitors({
      source,
      hashtag: readOptionalString(args, 'hashtag'),
      keyword: readOptionalString(args, 'keyword'),
      chromeOrigin: readOptionalString(args, 'chrome-origin'),
      remoteDebuggingPort: readNumber(args, 'remote-debugging-port'),
      targetCompetitors: readNumber(args, 'target-competitors'),
      timeoutMs: readNumber(args, 'timeout-ms'),
      includeRaw: args.values.has('include-raw'),
      profile: readOptionalProfile(args),
      profileDir: readOptionalString(args, 'profile-dir'),
      chromePath: readOptionalString(args, 'chrome-path'),
      ...resolveHeadlessFlag(args),
      ...(args.values.has('force-headless') ? { forceHeadless: true } : {}),
      ...(args.values.has('keep-chrome-open') ? { keepChromeOpen: true } : {}),
      reporter
    })
    const profiles = discovered.output.profiles.map((profile) => ({
      username: profile.username,
      followers: profile.followers ?? 0,
      bio: profile.bio ?? ''
    }))
    await writeOutput(args, {
      profiles,
      total: profiles.length,
      target: discovered.input.targetCompetitors ?? 0
    })
    return
  }

  throw new Error(`Unknown command: ${args.command}`)
}

async function captureManyUsernames(input: {
  usernames: string[]
  postsPerProfile: number
  minPosts?: number
  mode?: StandardCrawlerOutput['input']['mode']
  args: ParsedArgs
  reporter: ProgressReporter
}): Promise<StandardCrawlerOutput> {
  const startedAt = new Date().toISOString()
  const aggregatedProfiles: StandardCrawlerOutput['output']['profiles'] = []
  const aggregatedPosts: StandardCrawlerOutput['output']['posts'] = []
  const perProfile: NonNullable<StandardCrawlerOutput['meta']['capture']>['perProfile'] = []
  const warnings: string[] = []
  let okAny = false

  const requestedConcurrency = Math.max(1, Math.min(8, readNumber(input.args, 'capture-concurrency') ?? 4))
  const scrollIntervalMs = readNumber(input.args, 'scroll-interval-ms')
  const initialDelayMs = readNumber(input.args, 'initial-delay-ms')
  const queue = [...input.usernames]
  const useNewTab = requestedConcurrency > 1

  const worker = async (): Promise<void> => {
    for (;;) {
      const username = queue.shift()
      if (!username) return
      const startedCaptureAt = Date.now()
      const captured = await captureInstagramData({
        username,
        chromeOrigin: readOptionalString(input.args, 'chrome-origin'),
        remoteDebuggingPort: readNumber(input.args, 'remote-debugging-port'),
        maxResponses: input.postsPerProfile,
        timeoutMs: readNumber(input.args, 'timeout-ms'),
        includeRaw: input.args.values.has('include-raw'),
        ...(useNewTab ? { openNewTab: true } : {}),
        ...(input.args.values.has('keep-tab-open') ? { keepTabOpen: true } : {}),
        ...(scrollIntervalMs ? { scrollIntervalMs } : {}),
        ...(initialDelayMs !== undefined ? { initialDelayMs } : {}),
        profile: readOptionalProfile(input.args),
        profileDir: readOptionalString(input.args, 'profile-dir'),
        chromePath: readOptionalString(input.args, 'chrome-path'),
        ...resolveHeadlessFlag(input.args),
        ...(input.args.values.has('force-headless') ? { forceHeadless: true } : {}),
        ...(input.args.values.has('keep-chrome-open') ? { keepChromeOpen: true } : {}),
        reporter: input.reporter
      })
      const posts = captured.output?.posts ?? []
      const profiles = captured.output?.profiles ?? []
      aggregatedProfiles.push(...profiles)
      aggregatedPosts.push(...posts)
      warnings.push(...(captured.meta?.warnings ?? []))
      perProfile.push({
        username,
        postCount: posts.length,
        profileCount: profiles.length,
        ms: Date.now() - startedCaptureAt,
        ...(captured.ok ? {} : { stopReason: 'capture_failed', error: captured.error ?? { code: 'INSTAGRAM_CDP_CAPTURE_FAILED', message: 'capture failed' } })
      })
      if (captured.ok) okAny = true
    }
  }

  await Promise.all(Array.from({ length: requestedConcurrency }, () => worker()))

  const finishedAt = new Date().toISOString()
  const outputTypes: StandardCrawlerOutput['outputTypes'] = []
  if (aggregatedProfiles.length > 0) outputTypes.push('Profile Data List')
  if (aggregatedPosts.length > 0) outputTypes.push('Post Data List')

  return {
    ok: okAny,
    schemaVersion: '1.0',
    outputTypes: outputTypes.length > 0 ? outputTypes : ['Profile Data List', 'Post Data List'],
    input: {
      target: 'instagram',
      mode: input.mode ?? 'profile_capture',
      maxResponses: input.postsPerProfile,
      postsPerProfile: input.postsPerProfile,
      ...(input.minPosts ? { minPosts: input.minPosts } : {}),
      chromeOrigin: readOptionalString(input.args, 'chrome-origin')
    },
    output: {
      profiles: aggregatedProfiles,
      posts: aggregatedPosts
    },
    meta: {
      profileCount: aggregatedProfiles.length,
      postCount: aggregatedPosts.length,
      startedAt,
      finishedAt,
      warnings,
      capture: { perProfile, startedAt, finishedAt }
    },
    ...(okAny ? {} : { error: { code: 'INSTAGRAM_CDP_CAPTURE_FAILED', message: 'All captures failed.' } })
  }
}

async function resolveUsernames(args: ParsedArgs): Promise<string[]> {
  const fromFlag = readOptionalString(args, 'usernames')
  const fromFile = readOptionalString(args, 'from-file')
  const usernames = new Set<string>()
  if (fromFlag) {
    for (const part of fromFlag.split(',')) {
      const trimmed = part.trim().replace(/^@/, '')
      if (trimmed) usernames.add(trimmed)
    }
  }
  if (fromFile) {
    const text = await readFile(resolve(fromFile), 'utf8')
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      throw new Error(`--from-file "${fromFile}" is not valid JSON.`)
    }
    const candidates = extractUsernamesFromPayload(payload)
    for (const candidate of candidates) usernames.add(candidate)
  }
  return [...usernames]
}

async function resolveProfileUsernames(args: ParsedArgs): Promise<string[]> {
  const usernames = new Set<string>()
  const username = readOptionalString(args, 'username')
  if (username) usernames.add(username.trim().replace(/^@/, ''))
  for (const item of await resolveUsernames(args)) usernames.add(item)
  return [...usernames]
}

function extractUsernamesFromPayload(payload: unknown): string[] {
  const out: string[] = []
  if (!payload || typeof payload !== 'object') return out
  const root = payload as Record<string, unknown>
  const outputRecord = root.output && typeof root.output === 'object' ? root.output as Record<string, unknown> : null
  const profileList = Array.isArray(outputRecord?.profiles) ? outputRecord!.profiles as unknown[] : []
  for (const item of profileList) {
    if (item && typeof item === 'object') {
      const username = (item as Record<string, unknown>).username
      if (typeof username === 'string' && username.trim()) out.push(username.trim().replace(/^@/, ''))
    }
  }
  return out
}

function readProfile(args: ParsedArgs, fallback: ProfileName): ProfileName {
  const raw = readOptionalString(args, 'profile')
  if (raw === 'login' || raw === 'public' || raw === 'flow') return raw
  return fallback
}

function readOptionalProfile(args: ParsedArgs): ProfileName | undefined {
  const raw = readOptionalString(args, 'profile')
  if (raw === 'login' || raw === 'public' || raw === 'flow') return raw
  return undefined
}

function resolveHeadlessFlag(args: ParsedArgs): { headless?: boolean } {
  if (args.values.has('headless')) return { headless: true }
  if (args.values.has('headed')) return { headless: false }
  return {}
}

function resolveChromeOrigin(args: ParsedArgs): string | undefined {
  const chromeOrigin = readOptionalString(args, 'chrome-origin')
  if (chromeOrigin) return chromeOrigin
  const port = readNumber(args, 'remote-debugging-port') ?? readNumber(args, 'port')
  if (port) return `http://127.0.0.1:${port}`
  return `http://127.0.0.1:${defaultPortFor(readProfile(args, 'flow'))}`
}

function resolveFlowPrompt(args: ParsedArgs): string {
  return readOptionalString(args, 'prompt') ?? args.positionals.join(' ').trim()
}

function readFlowRatio(args: ParsedArgs): FlowGenerateRatio | undefined {
  const ratio = readOptionalString(args, 'ratio')
  if (!ratio) return undefined
  if (ratio === '16:9' || ratio === '4:3' || ratio === '1:1' || ratio === '3:4' || ratio === '9:16') return ratio
  throw new Error(`Unsupported --ratio "${ratio}". Use 16:9, 4:3, 1:1, 3:4, or 9:16.`)
}

function readFlowVariations(args: ParsedArgs): FlowGenerateVariations | undefined {
  const value = readNumber(args, 'variations')
  if (!value) return undefined
  if (value === 1 || value === 2 || value === 3 || value === 4) return value
  throw new Error(`Unsupported --variations "${value}". Use 1, 2, 3, or 4.`)
}

async function findFlowTargetForDownload(args: ParsedArgs, chromeOrigin: string): Promise<{ webSocketDebuggerUrl?: string }> {
  return findFlowTarget({
    chromeOrigin,
    tabUrlIncludes: readOptionalString(args, 'tab-url-includes') ?? '/tools/flow/project/'
  })
}

function resolveReporter(args: ParsedArgs): ProgressReporter {
  return args.values.has('quiet') ? silentReporter() : stderrReporter()
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = '', ...rest] = argv
  const values = new Map<string, string | true>()
  const positionals: string[] = []
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }
    const withoutPrefix = token.slice(2)
    const inline = withoutPrefix.indexOf('=')
    if (inline >= 0) {
      values.set(withoutPrefix.slice(0, inline), withoutPrefix.slice(inline + 1))
      continue
    }
    const next = rest[index + 1]
    if (next && !next.startsWith('--')) {
      values.set(withoutPrefix, next)
      index += 1
    } else {
      values.set(withoutPrefix, true)
    }
  }
  return { command, values, positionals }
}

function readOptionalString(args: ParsedArgs, name: string): string | undefined {
  const value = args.values.get(name)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function readNumber(args: ParsedArgs, name: string): number | undefined {
  const value = args.values.get(name)
  if (typeof value !== 'string') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}

type SimpleProfile = { username: string; followers: number; bio: string; avgLikes: number }

function simplifyProfiles(output: StandardCrawlerOutput): SimpleProfile[] {
  return output.output.profiles.map((profile) => ({
    username: profile.username,
    followers: profile.followers ?? 0,
    bio: profile.bio ?? '',
    avgLikes: profile.avgLikes ?? 0
  }))
}

function simplifyCaptureOutput(output: StandardCrawlerOutput) {
  const profiles = simplifyProfiles(output)
  const posts = output.output.posts.map((post) => ({
    postUrl: post.postUrl,
    username: post.username ?? '',
    likes: post.likes ?? 0,
    comments: post.comments ?? 0,
    timestamp: post.timestamp ?? '',
    caption: post.caption ?? '',
    ...(post.media ? { media: post.media } : {})
  }))
  return { profiles, posts, total: posts.length }
}

function simplifyAvgLikesOutput(output: StandardCrawlerOutput) {
  const profiles = simplifyProfiles(output)
  return { profiles, total: profiles.length }
}

async function writeOutput(args: ParsedArgs, value: unknown): Promise<void> {
  const outputPath = readOptionalString(args, 'output')
  const json = `${JSON.stringify(value, null, 2)}\n`
  if (!outputPath) {
    process.stdout.write(json)
    return
  }
  const resolved = resolve(outputPath)
  await mkdir(dirname(resolved), { recursive: true })
  await writeFile(resolved, json, 'utf8')
}

function printHelp(): void {
  process.stdout.write(`Research Crawler

Usage:
  research-crawler open-chrome [--profile login|public|flow] [--headless|--headed] [--force-headless]
                               [--url URL] [--profile-dir DIR] [--remote-debugging-port 9222]
  research-crawler capture-instagram-profile --username NAME [--posts-per-profile 30] [--output result.json]
                                             [--open-new-tab] [--keep-tab-open] [--keep-chrome-open]
  research-crawler capture-instagram-profile --usernames a,b,c [--posts-per-profile 30]
  research-crawler capture-instagram-profile --from-file discover.json [--posts-per-profile 30]
  research-crawler capture-instagram-post --post-url https://www.instagram.com/p/CODE/ [--output result.json]
                                          [--open-new-tab] [--keep-tab-open]
  research-crawler setup-avg-likes --usernames a,b,c [--posts-per-profile 20] [--min-posts 20]
  research-crawler setup-avg-likes --from-file discover.json [--posts-per-profile 20] [--output avg-likes.json]
  research-crawler flow-generate "prompt text" [--ratio 1:1] [--variations 4] [--model "Nano Banana Pro"]
                                 [--profile flow|login|public] [--url FLOW_PROJECT_URL]
                                 [--remote-debugging-port 9224] [--generate-timeout-ms 120000]
                                 [--download-dir DIR] [--download-file-prefix PREFIX]
  research-crawler flow-download [--count 4] [--download-dir DIR] [--download-file-prefix PREFIX]
  research-crawler discover-instagram [--source explore|hashtag|keyword] [--hashtag TAG] [--keyword KEY] [--target-competitors 20]

Common options:
  --remote-debugging-port PORT
  --chrome-origin URL
  --timeout-ms MS
  --include-raw
  --output FILE
  --quiet                                 # silence stderr progress
  --max-responses N                       # legacy alias for --posts-per-profile (per-username)
`)
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
