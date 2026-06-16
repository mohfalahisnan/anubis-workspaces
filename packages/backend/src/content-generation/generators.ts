import { mkdirSync } from 'node:fs'
import { ensureFlowChrome, flowGenerate } from '@anubis/research-crawler'
import type { AppConfig, GenerationCapability, GenerationOutput, GenerationTask } from '@anubis/shared'
import { withCrawlerProfileDefaults } from '../chrome-defaults.js'

export interface GenerateCtx {
  contentId: string
  projectId: string
  /** Conversation workspace = the project's workdir (or a per-content fallback). The agent runs here. */
  workspaceDir: string
  /** Where generated media is saved + detected: `<workspaceDir>/outputs/generated-assets/<contentId>`. */
  assetDir: string
  /** Existing conversation tracking this task's generation (continue on retry). */
  conversationId?: string
  /** Persist a newly-created conversation id back onto the task. */
  onConversation?: (id: string) => void
}

export interface Generator {
  name: string
  capability: GenerationCapability
  generate(task: GenerationTask, ctx: GenerateCtx): Promise<GenerationOutput>
}

/** Text capability: carry the refined text forward verbatim (deterministic, free). */
export class TextGenerator implements Generator {
  name = 'carry-forward-text'
  capability: GenerationCapability = 'text'
  async generate(task: GenerationTask): Promise<GenerationOutput> {
    return { text: task.inputPrompt }
  }
}

export class GeneratorRegistry {
  private readonly byCapability = new Map<GenerationCapability, Generator>()
  constructor(generators: Generator[]) {
    for (const g of generators) this.byCapability.set(g.capability, g)
  }
  get(capability: GenerationCapability): Generator | undefined {
    return this.byCapability.get(capability)
  }
}

export interface FlowImageGeneratorDeps {
  getConfig: () => AppConfig
  getDataDir: () => string
}

/** Image capability via Google Flow (headed Chrome on the `flow` profile). */
export class FlowImageGenerator implements Generator {
  name = 'google-flow'
  capability: GenerationCapability = 'image'
  constructor(private readonly deps: FlowImageGeneratorDeps) {}

  async generate(task: GenerationTask, ctx: GenerateCtx): Promise<GenerationOutput> {
    mkdirSync(ctx.assetDir, { recursive: true })
    const cfg = this.deps.getConfig()
    const chromeOrigin = await ensureFlowChrome(withCrawlerProfileDefaults(
      { chromePath: cfg.chromePath },
      'flow', cfg, this.deps.getDataDir(),
    ))
    const result = await flowGenerate({
      chromeOrigin,
      prompt: task.inputPrompt,
      downloadDir: ctx.assetDir,
      downloadFilePrefix: `${task.type}-${task.id.slice(0, 8)}`,
    })
    return { assetPaths: result.downloadedImagePaths ?? [], meta: { resultEditUrls: result.resultEditUrls } }
  }
}
