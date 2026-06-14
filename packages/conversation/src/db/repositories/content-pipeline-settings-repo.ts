import type { PipelineAiStep, PipelineSettings, PipelineStepSettings } from '@anubis/shared'
import type { Db } from '../client.js'

interface Row {
  project_id: string
  steps: string | null
  updated_at: number
}

type Steps = PipelineSettings['steps']

function parseSteps(value: string | null): Steps {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Steps) : {}
  } catch {
    return {}
  }
}

/**
 * Per-project Content Studio pipeline settings — prompt template + agent-behaviour
 * overrides per step. One row per project; absent rows default to "no overrides"
 * so steps fall back to the shipped prompts and the profile's parameters.
 */
export class ContentPipelineSettingsRepo {
  constructor(private readonly db: Db) {}

  get(projectId: string): PipelineSettings {
    const row = this.db
      .prepare('SELECT * FROM content_pipeline_settings WHERE project_id = ?')
      .get(projectId) as Row | undefined
    if (!row) return { projectId, steps: {}, updatedAt: 0 }
    return { projectId, steps: parseSteps(row.steps), updatedAt: row.updated_at }
  }

  /** Replace the per-step overrides for a project. */
  put(projectId: string, steps: Partial<Record<PipelineAiStep, PipelineStepSettings>>): PipelineSettings {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO content_pipeline_settings (project_id, steps, updated_at)
      VALUES (@projectId, @steps, @updatedAt)
      ON CONFLICT(project_id) DO UPDATE SET steps = @steps, updated_at = @updatedAt
    `).run({ projectId, steps: JSON.stringify(steps ?? {}), updatedAt: now })
    return { projectId, steps: steps ?? {}, updatedAt: now }
  }
}
