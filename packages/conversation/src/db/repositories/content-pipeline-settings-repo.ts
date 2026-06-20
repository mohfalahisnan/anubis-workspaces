import type { GenerationProfileConfig, PipelineAiStep, PipelineSettings, PipelineStepSettings } from '@anubis/shared'
import type { Db } from '../client.js'

interface Row {
  project_id: string
  steps: string | null
  generation_profiles: string | null
  updated_at: number
}

type Steps = PipelineSettings['steps']

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as T) : fallback
  } catch {
    return fallback
  }
}

/**
 * Per-project Content Studio pipeline settings — per-step prompt/parameter
 * overrides plus image/video generation-profile overrides. One row per project;
 * absent rows default to "no overrides".
 */
export class ContentPipelineSettingsRepo {
  constructor(private readonly db: Db) {}

  get(projectId: string): PipelineSettings {
    const row = this.db
      .prepare('SELECT * FROM content_pipeline_settings WHERE project_id = ?')
      .get(projectId) as Row | undefined
    if (!row) return { projectId, steps: {}, generationProfiles: {}, updatedAt: 0 }
    return {
      projectId,
      steps: parseJson<Steps>(row.steps, {}),
      generationProfiles: parseJson<GenerationProfileConfig>(row.generation_profiles, {}),
      updatedAt: row.updated_at,
    }
  }

  /** Replace the per-step overrides and generation profiles for a project. */
  put(projectId: string, steps: Steps, generationProfiles: GenerationProfileConfig = {}): PipelineSettings {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO content_pipeline_settings (project_id, steps, generation_profiles, updated_at)
      VALUES (@projectId, @steps, @generationProfiles, @updatedAt)
      ON CONFLICT(project_id) DO UPDATE SET
        steps = @steps, generation_profiles = @generationProfiles, updated_at = @updatedAt
    `).run({
      projectId,
      steps: JSON.stringify(steps ?? {}),
      generationProfiles: JSON.stringify(generationProfiles ?? {}),
      updatedAt: now,
    })
    return { projectId, steps: steps ?? {}, generationProfiles: generationProfiles ?? {}, updatedAt: now }
  }
}
