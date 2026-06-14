import type { ContentPipeline } from '@anubis/shared'
import type { Db } from '../client.js'

interface Row {
  content_id: string
  raw_idea: string | null
  improved_brief: string | null
  refined_content: string | null
  ai_review: string | null
  human_review: string | null
  draft_output: string | null
  transcript: string | null
  transcript_source: string | null
  step_profiles: string | null
  agent_progress: string | null
  auto_iteration_count: number
  updated_at: number
}

type JsonFields = Pick<ContentPipeline, 'rawIdea' | 'improvedBrief' | 'refinedContent' | 'aiReview' | 'humanReview' | 'draftOutput' | 'stepProfiles' | 'agentProgress'>
type ScalarFields = Pick<ContentPipeline, 'transcript' | 'transcriptSource'>
export type PipelinePatch = Partial<JsonFields & ScalarFields>

function parse<T>(value: string | null): T | undefined {
  if (value == null) return undefined
  try { return JSON.parse(value) as T } catch { return undefined }
}

function toPipeline(row: Row): ContentPipeline {
  return {
    contentId: row.content_id,
    rawIdea: parse(row.raw_idea),
    improvedBrief: parse(row.improved_brief),
    refinedContent: parse(row.refined_content),
    aiReview: parse(row.ai_review),
    humanReview: parse(row.human_review),
    draftOutput: parse(row.draft_output),
    transcript: row.transcript ?? undefined,
    transcriptSource: row.transcript_source ?? undefined,
    stepProfiles: parse(row.step_profiles),
    agentProgress: parse(row.agent_progress),
    autoIterationCount: row.auto_iteration_count,
    updatedAt: row.updated_at,
  }
}

const COLUMN_MAP: Record<keyof PipelinePatch, string> = {
  rawIdea: 'raw_idea',
  improvedBrief: 'improved_brief',
  refinedContent: 'refined_content',
  aiReview: 'ai_review',
  humanReview: 'human_review',
  draftOutput: 'draft_output',
  transcript: 'transcript',
  transcriptSource: 'transcript_source',
  stepProfiles: 'step_profiles',
  agentProgress: 'agent_progress',
}

const SCALAR_KEYS = new Set<keyof PipelinePatch>(['transcript', 'transcriptSource'])

export class ContentPipelineRepo {
  constructor(private readonly db: Db) {}

  get(contentId: string): ContentPipeline {
    const row = this.db.prepare('SELECT * FROM content_pipeline WHERE content_id = ?').get(contentId) as Row | undefined
    if (!row) return { contentId, autoIterationCount: 0, updatedAt: 0 }
    return toPipeline(row)
  }

  patch(contentId: string, patch: PipelinePatch): ContentPipeline {
    this.ensure(contentId)
    const now = Date.now()
    const sets: string[] = []
    const params: Record<string, unknown> = { id: contentId, updated_at: now }
    for (const [key, column] of Object.entries(COLUMN_MAP) as Array<[keyof PipelinePatch, string]>) {
      if (!(key in patch)) continue
      const value = patch[key]
      sets.push(`${column} = @${column}`)
      params[column] = value == null ? null : SCALAR_KEYS.has(key) ? value : JSON.stringify(value)
    }
    sets.push('updated_at = @updated_at')
    this.db.prepare(`UPDATE content_pipeline SET ${sets.join(', ')} WHERE content_id = @id`).run(params)
    return this.get(contentId)
  }

  incrementIteration(contentId: string): number {
    this.ensure(contentId)
    this.db.prepare('UPDATE content_pipeline SET auto_iteration_count = auto_iteration_count + 1, updated_at = ? WHERE content_id = ?')
      .run(Date.now(), contentId)
    return this.get(contentId).autoIterationCount
  }

  resetIteration(contentId: string): void {
    this.ensure(contentId)
    this.db.prepare('UPDATE content_pipeline SET auto_iteration_count = 0, updated_at = ? WHERE content_id = ?')
      .run(Date.now(), contentId)
  }

  delete(contentId: string): void {
    this.db.prepare('DELETE FROM content_pipeline WHERE content_id = ?').run(contentId)
  }

  private ensure(contentId: string): void {
    this.db.prepare('INSERT OR IGNORE INTO content_pipeline (content_id) VALUES (?)').run(contentId)
  }
}
