import { randomUUID } from 'node:crypto'
import type { ExperienceScope, ExperienceType, Platform, Severity } from '../types.js'
import type {
  ExperienceMemoriesRepo, ExperienceMemory, RecallActiveInput,
} from '../db/repositories/experience-memories-repo.js'

export interface RecordExperienceInput {
  scope?: ExperienceScope
  workspaceId?: string | null
  platform?: Platform | null
  campaignId?: string | null
  agentId?: string | null
  type: ExperienceType
  title: string
  problem: string
  cause?: string | null
  correction: string
  triggerPattern?: string | null
  preventionRule?: string | null
  severity?: Severity
  sourceRunId?: string | null
  sourceDocumentId?: string | null
}

export interface SaveFeedbackInput {
  runId: string
  workspaceId: string
  platform?: Platform | null
  rating: 'good' | 'bad' | 'partial'
  feedback: string
  /** Default: create a memory unless rating === 'good'. */
  createExperienceMemory?: boolean
  memoryType?: ExperienceType
  severity?: Severity
}

export class ExperienceIndexService {
  constructor(private repo: ExperienceMemoriesRepo) {}

  recordCandidate(input: RecordExperienceInput, now: number = Date.now()): ExperienceMemory {
    const scope: ExperienceScope = input.scope ?? 'workspace'
    const m: ExperienceMemory = {
      id: randomUUID(),
      scope,
      workspaceId: scope === 'global' ? null : (input.workspaceId ?? null),
      platform: input.platform ?? null,
      campaignId: input.campaignId ?? null,
      agentId: input.agentId ?? null,
      type: input.type,
      title: input.title,
      problem: input.problem,
      cause: input.cause ?? null,
      correction: input.correction,
      triggerPattern: input.triggerPattern ?? null,
      preventionRule: input.preventionRule ?? null,
      severity: input.severity ?? 'medium',
      status: 'candidate',
      usageCount: 0,
      successCount: 0,
      failureCount: 0,
      confidence: 0,
      sourceRunId: input.sourceRunId ?? null,
      sourceDocumentId: input.sourceDocumentId ?? null,
      createdAt: now,
      updatedAt: now,
    }
    this.repo.insert(m)
    return m
  }

  saveFeedback(input: SaveFeedbackInput, now: number = Date.now()): ExperienceMemory | null {
    const shouldCreate = input.createExperienceMemory ?? input.rating !== 'good'
    if (!shouldCreate) return null
    const type: ExperienceType = input.memoryType ?? (input.rating === 'bad' ? 'mistake' : 'lesson')
    return this.recordCandidate({
      workspaceId: input.workspaceId,
      platform: input.platform ?? null,
      type,
      title: input.feedback.slice(0, 80),
      problem: input.feedback,
      correction: input.feedback,
      severity: input.severity ?? 'medium',
      sourceRunId: input.runId,
    }, now)
  }

  promote(id: string, now: number = Date.now()): void {
    this.repo.setStatus(id, 'active', now)
  }

  deprecate(id: string, now: number = Date.now()): void {
    this.repo.setStatus(id, 'deprecated', now)
  }

  recallActive(input: RecallActiveInput): ExperienceMemory[] {
    return this.repo.recallActive(input)
  }
}
