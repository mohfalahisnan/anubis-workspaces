import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LessonStore } from '../src/lesson-store.js'

let dataDir: string

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'anubis-lesson-'))
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
})

describe('LessonStore', () => {
  it('writes a markdown file with frontmatter under <dataDir>/lesson', async () => {
    const store = new LessonStore(dataDir)
    const { path, file } = await store.write({
      lessonType: 'mistake', text: 'Avoid weak hooks', profileId: 'claude-research',
      nodeId: 'lw', runId: 'run-1',
    })
    expect(file).toMatch(/\.md$/)
    const md = await readFile(path, 'utf8')
    expect(md).toContain('type: mistake')
    expect(md).toContain('profile: claude-research')
    expect(md).toContain('Avoid weak hooks')
  })

  it('maintains an index.md listing every lesson', async () => {
    const store = new LessonStore(dataDir)
    await store.write({ lessonType: 'mistake', text: 'No clickbait', nodeId: 'a', runId: 'r1', now: 1 })
    await store.write({ lessonType: 'lesson', text: 'Strong hook first', nodeId: 'b', runId: 'r2', now: 2 })
    const index = await readFile(join(dataDir, 'lesson', 'index.md'), 'utf8')
    expect(index).toContain('# Lessons')
    expect(index).toContain('Total: 2')
    expect(index).toContain('No clickbait')
    expect(index).toContain('Strong hook first')
  })

  it('renders an injection block, newest first', async () => {
    const store = new LessonStore(dataDir)
    await store.write({ lessonType: 'mistake', text: 'Older lesson', nodeId: 'a', runId: 'r1', now: 1 })
    await store.write({ lessonType: 'lesson', text: 'Newer lesson', nodeId: 'b', runId: 'r2', now: 2 })
    const text = await store.injectionText()
    expect(text).toContain('<workflow-lessons count="2">')
    expect(text).toContain('Older lesson')
    expect(text).toContain('Newer lesson')
    // Newest first.
    expect(text.indexOf('Newer lesson')).toBeLessThan(text.indexOf('Older lesson'))
  })

  it('returns an empty injection block when there are no lessons', async () => {
    const store = new LessonStore(dataDir)
    expect(await store.injectionText()).toBe('')
  })
})
