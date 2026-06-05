import type { Db } from '../types.js'
import type {
  ExperienceScope, ExperienceType, MemoryStatus, Platform, Severity,
} from '../../types.js'

export interface ExperienceMemory {
  id: string
  scope: ExperienceScope
  workspaceId: string | null
  platform: Platform | null
  campaignId: string | null
  agentId: string | null
  type: ExperienceType
  title: string
  problem: string
  cause: string | null
  correction: string
  triggerPattern: string | null
  preventionRule: string | null
  severity: Severity
  status: MemoryStatus
  usageCount: number
  successCount: number
  failureCount: number
  confidence: number
  sourceRunId: string | null
  sourceDocumentId: string | null
  createdAt: number
  updatedAt: number
}

export interface RecallActiveInput {
  workspaceId: string
  platform?: Platform | null
  limit?: number
}

interface Row {
  id: string
  scope: string
  workspace_id: string | null
  platform: string | null
  campaign_id: string | null
  agent_id: string | null
  type: string
  title: string
  problem: string
  cause: string | null
  correction: string
  trigger_pattern: string | null
  prevention_rule: string | null
  severity: string
  status: string
  usage_count: number
  success_count: number
  failure_count: number
  confidence: number
  source_run_id: string | null
  source_document_id: string | null
  created_at: number
  updated_at: number
}

function toMemory(r: Row): ExperienceMemory {
  return {
    id: r.id,
    scope: r.scope as ExperienceScope,
    workspaceId: r.workspace_id,
    platform: (r.platform as Platform | null) ?? null,
    campaignId: r.campaign_id,
    agentId: r.agent_id,
    type: r.type as ExperienceType,
    title: r.title,
    problem: r.problem,
    cause: r.cause,
    correction: r.correction,
    triggerPattern: r.trigger_pattern,
    preventionRule: r.prevention_rule,
    severity: r.severity as Severity,
    status: r.status as MemoryStatus,
    usageCount: r.usage_count,
    successCount: r.success_count,
    failureCount: r.failure_count,
    confidence: r.confidence,
    sourceRunId: r.source_run_id,
    sourceDocumentId: r.source_document_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export class ExperienceMemoriesRepo {
  constructor(private db: Db) {}

  insert(m: ExperienceMemory): void {
    this.db.prepare(`
      INSERT INTO experience_memories (
        id, scope, workspace_id, platform, campaign_id, agent_id, type, title,
        problem, cause, correction, trigger_pattern, prevention_rule, severity,
        status, usage_count, success_count, failure_count, confidence,
        source_run_id, source_document_id, created_at, updated_at
      ) VALUES (
        @id, @scope, @workspaceId, @platform, @campaignId, @agentId, @type, @title,
        @problem, @cause, @correction, @triggerPattern, @preventionRule, @severity,
        @status, @usageCount, @successCount, @failureCount, @confidence,
        @sourceRunId, @sourceDocumentId, @createdAt, @updatedAt
      )
    `).run({
      id: m.id,
      scope: m.scope,
      workspaceId: m.workspaceId ?? null,
      platform: m.platform ?? null,
      campaignId: m.campaignId ?? null,
      agentId: m.agentId ?? null,
      type: m.type,
      title: m.title,
      problem: m.problem,
      cause: m.cause ?? null,
      correction: m.correction,
      triggerPattern: m.triggerPattern ?? null,
      preventionRule: m.preventionRule ?? null,
      severity: m.severity,
      status: m.status,
      usageCount: m.usageCount,
      successCount: m.successCount,
      failureCount: m.failureCount,
      confidence: m.confidence,
      sourceRunId: m.sourceRunId ?? null,
      sourceDocumentId: m.sourceDocumentId ?? null,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    })
  }

  findById(id: string): ExperienceMemory | null {
    const r = this.db.prepare('SELECT * FROM experience_memories WHERE id = ?').get(id) as
      | Row | undefined
    return r ? toMemory(r) : null
  }

  setStatus(id: string, status: MemoryStatus, now: number = Date.now()): void {
    this.db
      .prepare('UPDATE experience_memories SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, id)
  }

  recallActive(input: RecallActiveInput): ExperienceMemory[] {
    const rows = this.db.prepare(`
      SELECT * FROM experience_memories
      WHERE status IN ('active', 'reinforced')
        AND (workspace_id = @workspaceId OR workspace_id IS NULL)
        AND (@platform IS NULL OR platform IS NULL OR platform = @platform)
      ORDER BY confidence DESC, updated_at DESC
    `).all({
      workspaceId: input.workspaceId,
      platform: input.platform ?? null,
    }) as Row[]
    const mapped = rows.map(toMemory)
    return typeof input.limit === 'number' ? mapped.slice(0, input.limit) : mapped
  }
}
