import { describe, it, expect } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { WorkflowsRepo } from '../../src/db/repositories/workflows-repo.js'
import { BUILTIN_WORKFLOWS } from '../../src/workflows/builtin.js'

function freshRepo() {
  const db = openDatabase(':memory:')
  runMigrations(db, MIGRATIONS)
  return new WorkflowsRepo(db)
}

describe('WorkflowsRepo.seedBuiltins', () => {
  it('seeds the IG content pipeline, pre-published and runnable', () => {
    const repo = freshRepo()
    repo.seedBuiltins()

    const wf = repo.get('builtin-ig-content-pipeline')
    expect(wf).not.toBeNull()
    expect(wf!.name).toBe('IG Content Pipeline')
    // Ships pre-published so it's runnable once configured.
    expect(wf!.publishedGraph).toBeTruthy()
    expect(wf!.draftGraph).toBe(wf!.publishedGraph)
  })

  it('seeds a graph wired analyze → improve → review with the Original Copy viewer', () => {
    const repo = freshRepo()
    repo.seedBuiltins()
    const graph = JSON.parse(repo.get('builtin-ig-content-pipeline')!.draftGraph) as {
      nodes: Array<{ id: string; type: string }>
      edges: Array<{ source: string; target: string; sourceHandle?: string }>
    }

    const byType = graph.nodes.map((n) => n.type)
    expect(byType).toContain('instagramPost')
    expect(byType).toContain('aiAgentConversation')
    expect(byType).toContain('originalCopy')
    expect(byType).toContain('humanApproval')

    // The Original Copy viewer is fed from the source, not the analyst.
    const original = graph.edges.find((e) => e.target === 'original-copy')
    expect(original?.source).toBe('ig-source')

    // The approved review branch feeds the final display.
    const approved = graph.edges.find((e) => e.source === 'review' && e.target === 'final-copy')
    expect(approved?.sourceHandle).toBe('approved')
  })

  it('is idempotent — re-seeding does not duplicate', () => {
    const repo = freshRepo()
    repo.seedBuiltins()
    repo.seedBuiltins()
    expect(repo.list()).toHaveLength(BUILTIN_WORKFLOWS.length)
  })

  it('is edit-safe — a user edit survives a re-seed', () => {
    const repo = freshRepo()
    repo.seedBuiltins()
    repo.updateMeta('builtin-ig-content-pipeline', { name: 'My Custom Pipeline' }, 123)
    repo.seedBuiltins()
    expect(repo.get('builtin-ig-content-pipeline')!.name).toBe('My Custom Pipeline')
  })
})
