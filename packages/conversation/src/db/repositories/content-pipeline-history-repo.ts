import { randomUUID } from 'node:crypto'
import type { AgentKind, PipelineHistoryEntry, PipelineStep } from '@anubis/shared'
import type { Db } from '../client.js'

interface Row {
  id: string
  content_id: string
  iteration: number
  step: PipelineStep
  data: string
  profile_id: string | null
  agent: string | null
  created_at: number
}

export interface AppendHistoryInput {
  contentId: string
  iteration: number
  step: PipelineStep
  data: unknown
  profileId?: string
  agent?: AgentKind
}

function toEntry(r: Row): PipelineHistoryEntry {
  return {
    id: r.id,
    contentId: r.content_id,
    iteration: r.iteration,
    step: r.step,
    data: r.data == null ? undefined : JSON.parse(r.data),
    profileId: r.profile_id ?? undefined,
    agent: (r.agent ?? undefined) as AgentKind | undefined,
    createdAt: r.created_at,
  }
}

/**
 * Append-only store of pipeline step outputs. Unlike {@link ContentPipelineRepo}
 * (one mutable row per content item), every call to {@link append} inserts a new
 * row, so prior iterations of a brief/refined/review are never overwritten.
 */
export class ContentPipelineHistoryRepo {
  constructor(private readonly db: Db) {}

  append(input: AppendHistoryInput): PipelineHistoryEntry {
    const entry: PipelineHistoryEntry = {
      id: randomUUID(),
      contentId: input.contentId,
      iteration: input.iteration,
      step: input.step,
      data: input.data,
      profileId: input.profileId,
      agent: input.agent,
      createdAt: Date.now(),
    }
    this.db.prepare(`
      INSERT INTO content_pipeline_history (id, content_id, iteration, step, data, profile_id, agent, created_at)
      VALUES (@id, @contentId, @iteration, @step, @data, @profileId, @agent, @createdAt)
    `).run({
      id: entry.id,
      contentId: entry.contentId,
      iteration: entry.iteration,
      step: entry.step,
      data: JSON.stringify(entry.data ?? null),
      profileId: entry.profileId ?? null,
      agent: entry.agent ?? null,
      createdAt: entry.createdAt,
    })
    return entry
  }

  /** All history for a content item, oldest first (chronological creation order). */
  listByContent(contentId: string): PipelineHistoryEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM content_pipeline_history WHERE content_id = ? ORDER BY created_at ASC, rowid ASC')
      .all(contentId) as Row[]
    return rows.map(toEntry)
  }

  delete(contentId: string): void {
    this.db.prepare('DELETE FROM content_pipeline_history WHERE content_id = ?').run(contentId)
  }
}
