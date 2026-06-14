import { randomUUID } from 'node:crypto'
import type { GenerationTask, GenerationOutput } from '@anubis/shared'
import type { Db } from '../client.js'

interface Row {
  id: string
  content_id: string
  project_id: string
  type: GenerationTask['type']
  capability: GenerationTask['capability']
  generator: string
  input_prompt: string
  status: GenerationTask['status']
  output: string | null
  error: string | null
  retry_count: number
  created_at: number
  updated_at: number
}

export interface CreateTaskInput {
  contentId: string
  projectId: string
  type: GenerationTask['type']
  capability: GenerationTask['capability']
  inputPrompt: string
  status: GenerationTask['status']
}

export type GenerationTaskPatch = Partial<Pick<GenerationTask, 'status' | 'generator' | 'output' | 'error' | 'retryCount'>>

function parseOutput(value: string | null): GenerationOutput | undefined {
  if (value == null) return undefined
  try { return JSON.parse(value) as GenerationOutput } catch { return undefined }
}

function toTask(r: Row): GenerationTask {
  return {
    id: r.id, contentId: r.content_id, projectId: r.project_id, type: r.type, capability: r.capability,
    generator: r.generator, inputPrompt: r.input_prompt, status: r.status,
    output: parseOutput(r.output), error: r.error ?? undefined, retryCount: r.retry_count,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

export class ContentGenerationTasksRepo {
  constructor(private readonly db: Db) {}

  create(input: CreateTaskInput): GenerationTask {
    const now = Date.now()
    const task: GenerationTask = {
      id: randomUUID(), generator: '', output: undefined, error: undefined, retryCount: 0,
      createdAt: now, updatedAt: now, ...input,
    }
    this.db.prepare(`
      INSERT INTO content_generation_tasks (
        id, content_id, project_id, type, capability, generator, input_prompt, status,
        output, error, retry_count, created_at, updated_at
      ) VALUES (
        @id, @contentId, @projectId, @type, @capability, '', @inputPrompt, @status,
        NULL, NULL, 0, @createdAt, @updatedAt
      )
    `).run({
      id: task.id, contentId: task.contentId, projectId: task.projectId, type: task.type,
      capability: task.capability, inputPrompt: task.inputPrompt, status: task.status,
      createdAt: task.createdAt, updatedAt: task.updatedAt,
    })
    return task
  }

  get(id: string): GenerationTask | null {
    const row = this.db.prepare('SELECT * FROM content_generation_tasks WHERE id = ?').get(id) as Row | undefined
    return row ? toTask(row) : null
  }

  listByContent(contentId: string): GenerationTask[] {
    const rows = this.db.prepare('SELECT * FROM content_generation_tasks WHERE content_id = ? ORDER BY created_at ASC, rowid ASC').all(contentId) as Row[]
    return rows.map(toTask)
  }

  update(id: string, patch: GenerationTaskPatch): GenerationTask | null {
    const current = this.get(id)
    if (!current) return null
    const next: GenerationTask = { ...current, ...patch, updatedAt: Date.now() }
    this.db.prepare(`
      UPDATE content_generation_tasks
      SET status = ?, generator = ?, output = ?, error = ?, retry_count = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.status, next.generator,
      next.output == null ? null : JSON.stringify(next.output),
      next.error ?? null, next.retryCount, next.updatedAt, id,
    )
    return next
  }

  deleteByContent(contentId: string): void {
    this.db.prepare('DELETE FROM content_generation_tasks WHERE content_id = ?').run(contentId)
  }
}
