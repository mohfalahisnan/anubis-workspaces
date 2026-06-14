import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ContentLessonsRepo } from '../../src/db/repositories/content-lessons-repo.js'

function openMigratedDb() {
  const db = openDatabase(':memory:')
  runMigrations(db, MIGRATIONS)
  return db
}

const base = {
  projectId: 'default', contentId: 'c1', source: 'ai_review' as const,
  type: 'brand_alignment' as const, reason: 'r', whatWentWrong: 'w', howToImprove: 'h',
}

describe('ContentLessonsRepo', () => {
  it('creates a lesson with a generated id and createdAt', () => {
    const repo = new ContentLessonsRepo(openMigratedDb())
    const lesson = repo.create(base)
    expect(lesson.id).toBeTruthy()
    expect(lesson.createdAt).toBeGreaterThan(0)
    expect(lesson.source).toBe('ai_review')
  })

  it('lists by content id, newest first', () => {
    const repo = new ContentLessonsRepo(openMigratedDb())
    repo.create({ ...base, reason: 'first' })
    repo.create({ ...base, reason: 'second' })
    const all = repo.listByContent('c1')
    expect(all.map((l) => l.reason)).toEqual(['second', 'first'])
  })

  it('lists recent lessons for a project filtered by type', () => {
    const repo = new ContentLessonsRepo(openMigratedDb())
    repo.create({ ...base, type: 'tone_of_voice' })
    repo.create({ ...base, type: 'brand_alignment' })
    const tone = repo.listForInjection({ projectId: 'default', types: ['tone_of_voice'], limit: 5 })
    expect(tone).toHaveLength(1)
    expect(tone[0]!.type).toBe('tone_of_voice')
  })
})
