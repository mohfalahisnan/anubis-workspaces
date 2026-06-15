import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ContentGenerationTasksRepo } from '../../src/db/repositories/content-generation-tasks-repo.js'

function repo() {
  const db = openDatabase(':memory:')
  runMigrations(db, MIGRATIONS)
  return new ContentGenerationTasksRepo(db)
}

const base = {
  contentId: 'c1', projectId: 'default', type: 'image' as const, capability: 'image' as const,
  inputPrompt: 'a cat', status: 'pending' as const,
}

describe('ContentGenerationTasksRepo', () => {
  it('creates and lists tasks by content, oldest first', () => {
    const r = repo()
    r.create({ ...base, type: 'final_caption', capability: 'text' })
    r.create({ ...base, type: 'image' })
    const tasks = r.listByContent('c1')
    expect(tasks).toHaveLength(2)
    expect(tasks[0]!.type).toBe('final_caption')
    expect(tasks[1]!.capability).toBe('image')
  })

  it('updates status, output, error, generator and retry count', () => {
    const r = repo()
    const t = r.create(base)
    const updated = r.update(t.id, { status: 'completed', generator: 'flow', output: { assetPaths: ['/x.png'] }, retryCount: 1 })!
    expect(updated.status).toBe('completed')
    expect(updated.generator).toBe('flow')
    expect(updated.output?.assetPaths).toEqual(['/x.png'])
    expect(updated.retryCount).toBe(1)
  })

  it('deletes all tasks for a content id', () => {
    const r = repo()
    r.create(base)
    r.create({ ...base, type: 'final_caption', capability: 'text' })
    r.deleteByContent('c1')
    expect(r.listByContent('c1')).toHaveLength(0)
  })

  it('round-trips conversationId through create and update', () => {
    const r = repo()
    const t = r.create(base)
    expect(t.conversationId).toBeUndefined()
    const updated = r.update(t.id, { conversationId: 'conv-1' })!
    expect(updated.conversationId).toBe('conv-1')
    expect(r.get(t.id)!.conversationId).toBe('conv-1')
  })
})
