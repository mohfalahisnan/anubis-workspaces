import type { Db } from '../types.js'
import type { Platform } from '../../types.js'

export type ValidationStatus = 'passed' | 'failed' | 'needs_review'

export interface AgentRun {
  id: string
  workspaceId: string
  platform: Platform | null
  campaignId: string | null
  agentId: string
  workflowId: string | null
  taskType: string
  userInput: string
  intent: string
  retrievedChunkIds: string[]
  retrievedDecisionIds: string[]
  retrievedExperienceMemoryIds: string[]
  retrievedSimilarityItemIds: string[]
  contextPackId: string | null
  plan: string | null
  output: string
  validationStatus: ValidationStatus
  humanFeedback: string | null
  errorType: string | null
  errorSummary: string | null
  createdAt: number
}

interface Row {
  id: string
  workspace_id: string
  platform: string | null
  campaign_id: string | null
  agent_id: string
  workflow_id: string | null
  task_type: string
  user_input: string
  intent: string
  retrieved_chunk_ids: string
  retrieved_decision_ids: string
  retrieved_experience_memory_ids: string
  retrieved_similarity_item_ids: string
  context_pack_id: string | null
  plan: string | null
  output: string
  validation_status: string
  human_feedback: string | null
  error_type: string | null
  error_summary: string | null
  created_at: number
}

function parseArr(s: string): string[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? (v as string[]) : [] } catch { return [] }
}

function toRun(r: Row): AgentRun {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    platform: (r.platform as Platform | null) ?? null,
    campaignId: r.campaign_id,
    agentId: r.agent_id,
    workflowId: r.workflow_id,
    taskType: r.task_type,
    userInput: r.user_input,
    intent: r.intent,
    retrievedChunkIds: parseArr(r.retrieved_chunk_ids),
    retrievedDecisionIds: parseArr(r.retrieved_decision_ids),
    retrievedExperienceMemoryIds: parseArr(r.retrieved_experience_memory_ids),
    retrievedSimilarityItemIds: parseArr(r.retrieved_similarity_item_ids),
    contextPackId: r.context_pack_id,
    plan: r.plan,
    output: r.output,
    validationStatus: r.validation_status as ValidationStatus,
    humanFeedback: r.human_feedback,
    errorType: r.error_type,
    errorSummary: r.error_summary,
    createdAt: r.created_at,
  }
}

export class AgentRunsRepo {
  constructor(private db: Db) {}

  insert(run: AgentRun): void {
    this.db.prepare(`
      INSERT INTO agent_runs (
        id, workspace_id, platform, campaign_id, agent_id, workflow_id, task_type,
        user_input, intent, retrieved_chunk_ids, retrieved_decision_ids,
        retrieved_experience_memory_ids, retrieved_similarity_item_ids,
        context_pack_id, plan, output, validation_status, human_feedback,
        error_type, error_summary, created_at
      ) VALUES (
        @id, @workspaceId, @platform, @campaignId, @agentId, @workflowId, @taskType,
        @userInput, @intent, @retrievedChunkIds, @retrievedDecisionIds,
        @retrievedExperienceMemoryIds, @retrievedSimilarityItemIds,
        @contextPackId, @plan, @output, @validationStatus, @humanFeedback,
        @errorType, @errorSummary, @createdAt
      )
    `).run({
      id: run.id,
      workspaceId: run.workspaceId,
      platform: run.platform ?? null,
      campaignId: run.campaignId ?? null,
      agentId: run.agentId,
      workflowId: run.workflowId ?? null,
      taskType: run.taskType,
      userInput: run.userInput,
      intent: run.intent,
      retrievedChunkIds: JSON.stringify(run.retrievedChunkIds),
      retrievedDecisionIds: JSON.stringify(run.retrievedDecisionIds),
      retrievedExperienceMemoryIds: JSON.stringify(run.retrievedExperienceMemoryIds),
      retrievedSimilarityItemIds: JSON.stringify(run.retrievedSimilarityItemIds),
      contextPackId: run.contextPackId ?? null,
      plan: run.plan ?? null,
      output: run.output,
      validationStatus: run.validationStatus,
      humanFeedback: run.humanFeedback ?? null,
      errorType: run.errorType ?? null,
      errorSummary: run.errorSummary ?? null,
      createdAt: run.createdAt,
    })
  }

  findById(id: string): AgentRun | null {
    const r = this.db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as Row | undefined
    return r ? toRun(r) : null
  }

  listForWorkspace(workspaceId: string, limit = 100): AgentRun[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_runs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(workspaceId, limit) as Row[]
    return rows.map(toRun)
  }
}
