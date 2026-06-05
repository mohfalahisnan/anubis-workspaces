import type { ApprovalStatus, ContentType, Platform } from '../types.js'

export type ContentTaskType =
  | 'analyze_competitor' | 'build_brief' | 'generate_content'
  | 'rewrite_content' | 'review_content' | 'create_calendar'

export interface SimilarContent {
  id: string
  contentType: ContentType
  platform: Platform
  text: string
  reason: string
  performanceScore?: number
  engagementScore?: number
  brandFitScore?: number
  approvalStatus?: ApprovalStatus
  rejectionReason?: string
}

export interface Citation {
  sourceId: string
  sourceType: 'knowledge_document' | 'similarity_item' | 'experience_memory'
  title: string
  excerpt: string
}

export interface ContentContextPack {
  workspaceId: string
  platform: Platform
  taskType: ContentTaskType
  objective: string
  brandContext: {
    brandSummary: string
    toneOfVoice: string[]
    audience: string[]
    offers: string[]
    constraints: string[]
  }
  platformContext: {
    platform: Platform
    formatRules: string[]
    contentPatterns: string[]
    algorithmNotes: string[]
  }
  similarContent: {
    approved: SimilarContent[]
    competitor: SimilarContent[]
    rejected: SimilarContent[]
  }
  globalFrameworks: {
    hooks: string[]
    copywritingPatterns: string[]
    contentStructures: string[]
    ctaPatterns: string[]
  }
  workspaceRules: {
    mustFollow: string[]
    mustAvoid: string[]
    clientPreferences: string[]
  }
  experienceMemory: {
    previousMistakes: string[]
    reviewerFeedback: string[]
    validationRules: string[]
  }
  citations: Citation[]
  finalInstruction: string
}

export interface BuildContentContextInput {
  workspaceId: string
  platform: Platform
  taskType: ContentTaskType
  query: string
  objective: string
  campaignId?: string
  limitPerBucket?: number
}
