import { randomUUID } from 'node:crypto'
import type { Platform } from '../types.js'
import type { AgentRun, AgentRunsRepo, ValidationStatus } from '../db/repositories/agent-runs-repo.js'

export interface SaveAgentRunInput {
  workspaceId: string
  platform?: Platform | null
  campaignId?: string | null
  agentId: string
  workflowId?: string | null
  taskType: string
  userInput: string
  intent: string
  contextPackId?: string | null
  plan?: string | null
  output: string
  retrievedChunkIds?: string[]
  retrievedDecisionIds?: string[]
  retrievedExperienceMemoryIds?: string[]
  retrievedSimilarityItemIds?: string[]
  validationStatus: ValidationStatus
  humanFeedback?: string | null
  errorType?: string | null
  errorSummary?: string | null
}

export class AgentRunService {
  constructor(private repo: AgentRunsRepo) {}

  saveRun(input: SaveAgentRunInput, now: number = Date.now()): AgentRun {
    const run: AgentRun = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      platform: input.platform ?? null,
      campaignId: input.campaignId ?? null,
      agentId: input.agentId,
      workflowId: input.workflowId ?? null,
      taskType: input.taskType,
      userInput: input.userInput,
      intent: input.intent,
      retrievedChunkIds: input.retrievedChunkIds ?? [],
      retrievedDecisionIds: input.retrievedDecisionIds ?? [],
      retrievedExperienceMemoryIds: input.retrievedExperienceMemoryIds ?? [],
      retrievedSimilarityItemIds: input.retrievedSimilarityItemIds ?? [],
      contextPackId: input.contextPackId ?? null,
      plan: input.plan ?? null,
      output: input.output,
      validationStatus: input.validationStatus,
      humanFeedback: input.humanFeedback ?? null,
      errorType: input.errorType ?? null,
      errorSummary: input.errorSummary ?? null,
      createdAt: now,
    }
    this.repo.insert(run)
    return run
  }

  listForWorkspace(workspaceId: string, limit = 100): AgentRun[] {
    return this.repo.listForWorkspace(workspaceId, limit)
  }
}
