import type { Embedder } from '../embedding/embedder.js'
import type { BrandWorkspacesRepo } from '../db/repositories/brand-workspaces-repo.js'
import type { KnowledgeDocumentsRepo, ScoredDocument } from '../db/repositories/knowledge-documents-repo.js'
import type {
  ContentSimilarityItemsRepo,
  ScoredSimilarityItem,
} from '../db/repositories/content-similarity-items-repo.js'
import type {
  BuildContentContextInput,
  Citation,
  ContentContextPack,
  SimilarContent,
} from './types.js'

export interface ContextPackDeps {
  brands: BrandWorkspacesRepo
  docs: KnowledgeDocumentsRepo
  items: ContentSimilarityItemsRepo
  embedder: Embedder
}

function toSimilar(it: ScoredSimilarityItem): SimilarContent {
  return {
    // Identify by the stable source content id; fall back to the item id
    // (e.g. generated drafts that have no underlying contentId).
    id: it.contentId ?? it.id,
    contentType: it.contentType,
    platform: it.platform,
    text: it.normalizedText,
    reason: `cosine ${it.score.toFixed(3)}`,
    performanceScore: it.performanceScore ?? undefined,
    engagementScore: it.engagementScore ?? undefined,
    brandFitScore: it.brandFitScore ?? undefined,
    approvalStatus: it.approvalStatus ?? undefined,
    rejectionReason: it.rejectionReason ?? undefined,
  }
}

export class ContextPackService {
  constructor(private deps: ContextPackDeps) {}

  async buildContentContextPack(input: BuildContentContextInput): Promise<ContentContextPack> {
    const brand = this.deps.brands.findById(input.workspaceId)
    if (!brand) throw new Error(`Unknown brand workspace: ${input.workspaceId}`)

    const limit = input.limitPerBucket ?? 3
    const q = await this.deps.embedder.embed(`${input.objective}\n${input.query}`)
    const citations: Citation[] = []

    // --- Similar content: three SEPARATE queries → three distinct buckets ---
    const approved = this.deps.items.search({
      workspaceId: input.workspaceId, platform: input.platform, queryEmbedding: q,
      contentTypes: ['approved_post', 'own_post'], limit,
    })
    const competitor = this.deps.items.search({
      workspaceId: input.workspaceId, platform: input.platform, queryEmbedding: q,
      contentTypes: ['competitor_post'], limit,
    })
    const rejected = this.deps.items.search({
      workspaceId: input.workspaceId, platform: input.platform, queryEmbedding: q,
      contentTypes: ['rejected_post'], limit,
    })
    for (const it of [...approved, ...competitor, ...rejected]) {
      citations.push({
        sourceId: it.id, sourceType: 'similarity_item',
        title: it.contentType, excerpt: it.normalizedText.slice(0, 160),
      })
    }

    // --- Knowledge: global frameworks + platform rules + workspace guidelines ---
    const frameworks = this.deps.docs.searchSemantic({
      workspaceId: input.workspaceId, platform: input.platform, queryEmbedding: q,
      sourceTypes: ['global_framework'], limit: 5,
    })
    const platformRules = this.deps.docs.searchSemantic({
      workspaceId: input.workspaceId, platform: input.platform, queryEmbedding: q,
      sourceTypes: ['platform_rule'], limit: 5,
    })
    const guidelines = this.deps.docs.searchSemantic({
      workspaceId: input.workspaceId, platform: input.platform, queryEmbedding: q,
      sourceTypes: ['brand_guideline', 'sop'], includeGlobal: false, limit: 5,
    })
    const cite = (d: ScoredDocument) => citations.push({
      sourceId: d.id, sourceType: 'knowledge_document',
      title: d.title, excerpt: (d.summary ?? d.extractedText).slice(0, 160),
    })
    frameworks.forEach(cite); platformRules.forEach(cite); guidelines.forEach(cite)

    const summarize = (d: ScoredDocument) => d.summary ?? d.title

    const pack: ContentContextPack = {
      workspaceId: input.workspaceId,
      platform: input.platform,
      taskType: input.taskType,
      objective: input.objective,
      brandContext: {
        brandSummary: brand.brandSummary ?? '',
        toneOfVoice: brand.toneOfVoice,
        audience: brand.audience,
        offers: brand.offers,
        constraints: brand.constraints,
      },
      platformContext: {
        platform: input.platform,
        formatRules: platformRules.map(summarize),
        contentPatterns: [],
        algorithmNotes: [],
      },
      similarContent: {
        approved: approved.map(toSimilar),
        competitor: competitor.map(toSimilar),
        rejected: rejected.map(toSimilar),
      },
      globalFrameworks: {
        hooks: [],
        copywritingPatterns: frameworks.map(summarize),
        contentStructures: [],
        ctaPatterns: [],
      },
      workspaceRules: {
        mustFollow: guidelines.map(summarize),
        mustAvoid: brand.constraints,
        clientPreferences: [],
      },
      experienceMemory: {
        previousMistakes: [],   // populated in Phase 4
        reviewerFeedback: [],
        validationRules: [],
      },
      citations,
      finalInstruction: this.finalInstruction(input, brand.constraints),
    }
    return pack
  }

  private finalInstruction(input: BuildContentContextInput, constraints: string[]): string {
    const avoid = constraints.length ? ` Must avoid: ${constraints.join('; ')}.` : ''
    return `${input.objective} for platform "${input.platform}". ` +
      `Use the approved examples as positive references and the rejected examples ` +
      `strictly as patterns to avoid.${avoid}`
  }
}
