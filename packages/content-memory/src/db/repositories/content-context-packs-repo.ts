import type { Db } from '../types.js'

export interface ContentContextPackRecord {
  id: string
  workspaceId: string
  platform: string
  campaignId: string | null
  taskType: string
  objective: string
  query: string
  contextJson: unknown
  tokenCount: number
  createdAt: number
}

interface Row {
  id: string
  workspace_id: string
  platform: string
  campaign_id: string | null
  task_type: string
  objective: string
  query: string
  context_json: string
  token_count: number
  created_at: number
}

function toRecord(r: Row): ContentContextPackRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    platform: r.platform,
    campaignId: r.campaign_id,
    taskType: r.task_type,
    objective: r.objective,
    query: r.query,
    contextJson: JSON.parse(r.context_json),
    tokenCount: r.token_count,
    createdAt: r.created_at,
  }
}

export class ContentContextPacksRepo {
  constructor(private db: Db) {}

  save(rec: ContentContextPackRecord): void {
    this.db.prepare(`
      INSERT INTO content_context_packs (
        id, workspace_id, platform, campaign_id, task_type, objective, query,
        context_json, token_count, created_at
      ) VALUES (
        @id, @workspaceId, @platform, @campaignId, @taskType, @objective, @query,
        @contextJson, @tokenCount, @createdAt
      )
    `).run({
      id: rec.id,
      workspaceId: rec.workspaceId,
      platform: rec.platform,
      campaignId: rec.campaignId ?? null,
      taskType: rec.taskType,
      objective: rec.objective,
      query: rec.query,
      contextJson: JSON.stringify(rec.contextJson),
      tokenCount: rec.tokenCount,
      createdAt: rec.createdAt,
    })
  }

  findById(id: string): ContentContextPackRecord | null {
    const r = this.db
      .prepare('SELECT * FROM content_context_packs WHERE id = ?')
      .get(id) as Row | undefined
    return r ? toRecord(r) : null
  }
}
