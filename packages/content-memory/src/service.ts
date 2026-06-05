import { randomUUID } from 'node:crypto'
import type { ContentContextPacksRepo } from './db/repositories/content-context-packs-repo.js'
import type { ContextPackService } from './context-pack/context-pack-service.js'
import type { BuildContentContextInput, ContentContextPack } from './context-pack/types.js'

export interface ContentMemoryDeps {
  contextPack: ContextPackService
  packs: ContentContextPacksRepo
}

export interface BuildForContentTaskResult {
  packId: string
  pack: ContentContextPack
}

/** Rough token estimate: ~4 chars/token over the serialized pack. */
function estimateTokens(pack: ContentContextPack): number {
  return Math.ceil(JSON.stringify(pack).length / 4)
}

export class ContentMemoryService {
  constructor(private deps: ContentMemoryDeps) {}

  async buildForContentTask(
    input: BuildContentContextInput,
    now: number = Date.now(),
  ): Promise<BuildForContentTaskResult> {
    const pack = await this.deps.contextPack.buildContentContextPack(input)
    const packId = randomUUID()
    this.deps.packs.save({
      id: packId,
      workspaceId: input.workspaceId,
      platform: input.platform,
      campaignId: input.campaignId ?? null,
      taskType: input.taskType,
      objective: input.objective,
      query: input.query,
      contextJson: pack,
      tokenCount: estimateTokens(pack),
      createdAt: now,
    })
    return { packId, pack }
  }

  /** Load a previously built pack by id (e.g. for validation). */
  getPack(packId: string): ContentContextPack | null {
    const rec = this.deps.packs.findById(packId)
    return rec ? (rec.contextJson as ContentContextPack) : null
  }
}
