import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface LessonWriteInput {
  lessonType: 'mistake' | 'lesson'
  text: string
  profileId?: string
  nodeId: string
  runId: string
  now?: number
}

export interface LessonRecord {
  file: string
  lessonType: 'mistake' | 'lesson'
  profileId?: string
  nodeId?: string
  runId?: string
  created: number
  body: string
}

/** Most recent lessons injected into an agent prompt, and a hard char budget. */
const MAX_INJECTED = 50
const MAX_INJECTED_CHARS = 16_000

/**
 * Persists workflow "lessons" as markdown files under `<dataDir>/lesson/`, keeps
 * an `index.md`, and renders a bounded injection block so every workflow agent
 * can be primed with what past runs learned. Filenames are timestamp-prefixed so
 * a lexical sort is chronological.
 */
export class LessonStore {
  readonly dir: string

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'lesson')
  }

  async write(input: LessonWriteInput): Promise<{ path: string; file: string }> {
    await mkdir(this.dir, { recursive: true })
    const now = input.now ?? Date.now()
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
    const file = `${stamp}-${input.lessonType}-${randomUUID().slice(0, 8)}.md`
    const path = join(this.dir, file)
    await writeFile(path, renderLesson(input, now), 'utf8')
    await this.rebuildIndex()
    return { path, file }
  }

  /** Read every lesson file (newest first), excluding the index. */
  async list(): Promise<LessonRecord[]> {
    let names: string[]
    try {
      names = await readdir(this.dir)
    } catch {
      return []
    }
    const files = names.filter((n) => n.endsWith('.md') && n !== 'index.md').sort().reverse()
    const records: LessonRecord[] = []
    for (const file of files) {
      try {
        const raw = await readFile(join(this.dir, file), 'utf8')
        records.push(parseLesson(file, raw))
      } catch {
        /* skip unreadable lesson */
      }
    }
    return records
  }

  /** Rewrite `index.md` from the current lesson files. */
  async rebuildIndex(): Promise<void> {
    const lessons = await this.list()
    const lines = [
      '# Lessons',
      '',
      '> Auto-generated index of workflow lessons. Do not edit by hand.',
      '',
      `Total: ${lessons.length}`,
      '',
      '| Date | Type | Profile | Summary | File |',
      '| --- | --- | --- | --- | --- |',
      ...lessons.map((l) => {
        const date = new Date(l.created).toISOString().slice(0, 16).replace('T', ' ')
        const summary = firstLine(l.body).replace(/\|/g, '\\|').slice(0, 80)
        return `| ${date} | ${l.lessonType} | ${l.profileId ?? '—'} | ${summary} | [${l.file}](${l.file}) |`
      }),
      '',
    ]
    await writeFile(join(this.dir, 'index.md'), lines.join('\n'), 'utf8')
  }

  /**
   * A prompt block describing the most recent lessons, or `''` when there are
   * none. Bounded by count and total characters so it never dominates a prompt.
   */
  async injectionText(): Promise<string> {
    const lessons = (await this.list()).slice(0, MAX_INJECTED)
    if (lessons.length === 0) return ''
    const blocks: string[] = []
    let used = 0
    for (const l of lessons) {
      const label = l.lessonType === 'mistake' ? 'mistake — avoid this' : 'what works'
      const block = `### Lesson (${label})\n${l.body.trim()}`
      if (used + block.length > MAX_INJECTED_CHARS && blocks.length > 0) break
      blocks.push(block)
      used += block.length
    }
    return [
      `<workflow-lessons count="${blocks.length}">`,
      'Lessons learned from previous workflow runs. Apply them when producing your output —',
      'avoid the mistakes and reuse what works.',
      '',
      blocks.join('\n\n'),
      '</workflow-lessons>',
    ].join('\n')
  }
}

function renderLesson(input: LessonWriteInput, now: number): string {
  const fm = [
    '---',
    `type: ${input.lessonType}`,
    `profile: ${input.profileId ?? ''}`,
    `node: ${input.nodeId}`,
    `run: ${input.runId}`,
    `created: ${new Date(now).toISOString()}`,
    '---',
    '',
  ].join('\n')
  return `${fm}${input.text.trim()}\n`
}

function parseLesson(file: string, raw: string): LessonRecord {
  const meta: Record<string, string> = {}
  let body = raw
  const fmMatch = /^---\n([\s\S]*?)\n---\n?/.exec(raw)
  if (fmMatch) {
    for (const line of fmMatch[1].split('\n')) {
      const idx = line.indexOf(':')
      if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
    body = raw.slice(fmMatch[0].length)
  }
  const created = meta.created ? Date.parse(meta.created) : Number.NaN
  return {
    file,
    lessonType: meta.type === 'mistake' ? 'mistake' : 'lesson',
    profileId: meta.profile || undefined,
    nodeId: meta.node || undefined,
    runId: meta.run || undefined,
    created: Number.isNaN(created) ? 0 : created,
    body: body.trim(),
  }
}

function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim())
  return line ? line.trim() : ''
}
