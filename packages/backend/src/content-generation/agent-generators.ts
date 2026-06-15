import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { AgentKind, AppConfig, GenerationCapability, GenerationOutput, GenerationTask } from '@anubis/shared'
import type { GenerateCtx, Generator } from './generators.js'

/** Reserved image-profile value selecting the Google Flow browser generator. */
export const FLOW_IMAGE_PROFILE_ID = 'google-flow'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const VIDEO_EXTS = new Set(['.mp4'])

export type RunAgent = (input: {
  profileId: string
  prompt: string
  cwd: string
  title: string
  conversationId?: string
  onConversation?: (id: string) => void
}) => Promise<{ text: string; agent: AgentKind }>

/** Files in `dir` whose extension is in `exts` (basenames). */
function snapshot(dir: string, exts: Set<string>): Set<string> {
  if (!existsSync(dir)) return new Set()
  return new Set(readdirSync(dir).filter((f) => exts.has(extname(f).toLowerCase())))
}

/**
 * Run a profile agent in the asset dir and return the asset files it newly
 * created (by extension). Throws if it produced none.
 */
async function generateViaAgent(
  runAgent: RunAgent, profileId: string, prompt: string, ctx: GenerateCtx,
  exts: Set<string>, kind: string, title: string,
): Promise<GenerationOutput> {
  mkdirSync(ctx.assetDir, { recursive: true })
  const before = snapshot(ctx.assetDir, exts)
  const { agent } = await runAgent({
    profileId, prompt, cwd: ctx.assetDir, title,
    conversationId: ctx.conversationId,
    onConversation: ctx.onConversation,
  })
  const after = snapshot(ctx.assetDir, exts)
  const created = [...after].filter((f) => !before.has(f))
  if (created.length === 0) {
    throw new Error(`Agent produced no ${kind} file in the asset dir.`)
  }
  return { assetPaths: created.map((f) => join(ctx.assetDir, f)), meta: { agent, profileId } }
}

function imagePrompt(brief: string): string {
  return [
    'You are generating ONE image asset for a social-media post, in the current working directory.',
    'Use Codex native image generation by including $imagegen, and SAVE the result as a single PNG or JPG file in the current directory.',
    '',
    '=== IMAGE BRIEF ===',
    brief,
    '',
    'When finished, reply with ONLY the saved image filename.',
  ].join('\n')
}

function videoPrompt(brief: string): string {
  return [
    'You are generating ONE short social-media video as a single .mp4 file in the current working directory,',
    'using the open-source "hyperframes" npm package (HeyGen).',
    'Steps:',
    '1. If hyperframes is not installed in the current directory, run: npm install hyperframes',
    '2. Write the HTML/CSS scene(s) and a Node script (render.js) that imports hyperframes and renders the scene(s) to a single MP4 here.',
    '3. Run it (e.g. node render.js) so a single .mp4 is produced in the current directory.',
    '',
    '=== VIDEO BRIEF / SCRIPT ===',
    brief,
    '',
    'When finished, reply with ONLY the produced .mp4 filename.',
  ].join('\n')
}

export interface ImageGeneratorDeps {
  getConfig: () => AppConfig
  runAgent: RunAgent
  /** The Google Flow generator, used when the image profile is google-flow. */
  flow: Generator
}

/** Image capability: codex `$imagegen` agent by default; Google Flow when selected. */
export class ConfigurableImageGenerator implements Generator {
  name = 'agent-image'
  capability: GenerationCapability = 'image'
  constructor(private readonly deps: ImageGeneratorDeps) {}

  async generate(task: GenerationTask, ctx: GenerateCtx): Promise<GenerationOutput> {
    const selected = this.deps.getConfig().generationProfiles?.image
    if (selected === FLOW_IMAGE_PROFILE_ID) {
      return this.deps.flow.generate(task, ctx)
    }
    const profileId = selected ?? 'codex-image'
    return generateViaAgent(this.deps.runAgent, profileId, imagePrompt(task.inputPrompt), ctx, IMAGE_EXTS, 'image', `Image · ${ctx.contentId}`)
  }
}

export interface VideoGeneratorDeps {
  getConfig: () => AppConfig
  runAgent: RunAgent
}

/** Video capability: an agent driving the hyperframes npm package → MP4. */
export class AgentVideoGenerator implements Generator {
  name = 'agent-video'
  capability: GenerationCapability = 'video'
  constructor(private readonly deps: VideoGeneratorDeps) {}

  async generate(task: GenerationTask, ctx: GenerateCtx): Promise<GenerationOutput> {
    const profileId = this.deps.getConfig().generationProfiles?.video ?? 'codex-video'
    return generateViaAgent(this.deps.runAgent, profileId, videoPrompt(task.inputPrompt), ctx, VIDEO_EXTS, 'video', `Video · ${ctx.contentId}`)
  }
}
