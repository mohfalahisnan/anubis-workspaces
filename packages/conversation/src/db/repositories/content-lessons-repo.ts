import { randomUUID } from 'node:crypto'
import type { ContentLesson, LessonType } from '@anubis/shared'
import type { Db } from '../client.js'

interface Row {
  id: string
  project_id: string
  content_id: string
  source: ContentLesson['source']
  type: LessonType
  reason: string
  what_went_wrong: string
  how_to_improve: string
  related_brand_rule: string | null
  related_tone_rule: string | null
  related_niche_rule: string | null
  created_at: number
}

export interface CreateLessonInput {
  projectId: string
  contentId: string
  source: ContentLesson['source']
  type: LessonType
  reason: string
  whatWentWrong: string
  howToImprove: string
  relatedBrandRule?: string
  relatedToneRule?: string
  relatedNicheRule?: string
}

export interface InjectionQuery {
  projectId: string
  types?: LessonType[]
  limit?: number
}

function toLesson(r: Row): ContentLesson {
  return {
    id: r.id, projectId: r.project_id, contentId: r.content_id, source: r.source, type: r.type,
    reason: r.reason, whatWentWrong: r.what_went_wrong, howToImprove: r.how_to_improve,
    relatedBrandRule: r.related_brand_rule ?? undefined,
    relatedToneRule: r.related_tone_rule ?? undefined,
    relatedNicheRule: r.related_niche_rule ?? undefined,
    createdAt: r.created_at,
  }
}

export class ContentLessonsRepo {
  constructor(private readonly db: Db) {}

  create(input: CreateLessonInput): ContentLesson {
    const lesson: ContentLesson = { id: randomUUID(), createdAt: Date.now(), ...input }
    this.db.prepare(`
      INSERT INTO content_lessons (
        id, project_id, content_id, source, type, reason, what_went_wrong, how_to_improve,
        related_brand_rule, related_tone_rule, related_niche_rule, created_at
      ) VALUES (
        @id, @projectId, @contentId, @source, @type, @reason, @whatWentWrong, @howToImprove,
        @relatedBrandRule, @relatedToneRule, @relatedNicheRule, @createdAt
      )
    `).run({
      ...lesson,
      relatedBrandRule: lesson.relatedBrandRule ?? null,
      relatedToneRule: lesson.relatedToneRule ?? null,
      relatedNicheRule: lesson.relatedNicheRule ?? null,
    })
    return lesson
  }

  listByContent(contentId: string): ContentLesson[] {
    const rows = this.db.prepare('SELECT * FROM content_lessons WHERE content_id = ? ORDER BY created_at DESC, rowid DESC').all(contentId) as Row[]
    return rows.map(toLesson)
  }

  listByProject(projectId: string, limit = 200): ContentLesson[] {
    const rows = this.db.prepare('SELECT * FROM content_lessons WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(projectId, limit) as Row[]
    return rows.map(toLesson)
  }

  listForInjection(q: InjectionQuery): ContentLesson[] {
    const limit = q.limit ?? 8
    if (q.types?.length) {
      const placeholders = q.types.map(() => '?').join(',')
      const rows = this.db.prepare(
        `SELECT * FROM content_lessons WHERE project_id = ? AND type IN (${placeholders}) ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      ).all(q.projectId, ...q.types, limit) as Row[]
      return rows.map(toLesson)
    }
    return this.listByProject(q.projectId, limit)
  }
}
