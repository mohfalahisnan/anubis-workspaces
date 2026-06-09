import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { outputCapturerExecutor, type OutputCapturerOutput } from '../../src/executors/output-capturer.js'
import type { ExecutorContext } from '../../src/types.js'

type SavedOutput = Extract<OutputCapturerOutput, { filePath: string }>
type ErrorOutput = Extract<OutputCapturerOutput, { error: string }>

function createCtx(workspacePath?: string): ExecutorContext {
  return {
    crawler: { captureProfile: async () => ({ id: '', mediaUrls: [] }) },
    ocr: { extractFromImage: async () => '' },
    db: { getCapturedPost: async () => ({ id: '', mediaUrls: [] }) },
    fs: { writeRunArtifact: async () => '' },
    conversations: {
      createAndAwaitFirstTurn: async () => ({ conversationId: '', messageId: '', text: '' }),
      cancel: async () => {},
    },
    approvals: {
      waitFor: async () => ({ decision: 'approved' }),
    },
    lessons: {
      write: async () => ({ path: '' }),
    },
    runId: 'r1',
    signal: new AbortController().signal,
    emit: () => {},
    workspacePath,
  }
}

function expectSaved(out: OutputCapturerOutput): SavedOutput {
  expect('filePath' in out).toBe(true)
  if (!('filePath' in out)) throw new Error(`expected saved output, got ${JSON.stringify(out)}`)
  return out
}

function expectError(out: OutputCapturerOutput): ErrorOutput {
  expect('error' in out).toBe(true)
  if (!('error' in out)) throw new Error(`expected error output, got ${JSON.stringify(out)}`)
  return out
}

describe('outputCapturerExecutor', () => {
  it('saves string upstream output to md as-is', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'oc-test-'))
    try {
      const out = await outputCapturerExecutor.run(
        {
          nodeId: 'n1',
          config: {
            outputPath: tmp,
            filename: 'test-doc',
            extension: 'md',
          },
          upstream: {
            node0: 'Hello, World!',
          },
          downstream: [],
        },
        createCtx(tmp),
      )
      const saved = expectSaved(out)

      expect(saved).toMatchObject({
        filePath: join(tmp, 'test-doc.md'),
        filename: 'test-doc.md',
      })
      expect(saved.size).toBeGreaterThan(0)

      const savedContent = await readFile(saved.filePath, 'utf-8')
      expect(savedContent).toBe('Hello, World!')
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  it('serializes object to json formatted', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'oc-test-'))
    try {
      const out = await outputCapturerExecutor.run(
        {
          nodeId: 'n1',
          config: {
            outputPath: tmp,
            filename: 'test-json-{timestamp}',
            extension: 'json',
          },
          upstream: {
            node0: { hello: 'world' },
          },
          downstream: [],
        },
        createCtx(tmp),
      )
      const saved = expectSaved(out)

      expect(saved.filename).toMatch(/^test-json-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/)
      expect(isAbsolute(saved.filePath)).toBe(true)
      const savedContent = await readFile(saved.filePath, 'utf-8')
      expect(JSON.parse(savedContent)).toEqual({ hello: 'world' })
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  it('replaces {title} using upstream.title if present', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'oc-test-'))
    try {
      const out = await outputCapturerExecutor.run(
        {
          nodeId: 'n1',
          config: {
            outputPath: tmp,
            filename: 'my-{title}',
            extension: 'txt',
          },
          upstream: {
            node0: { title: 'Amazing Title', content: 'hello' },
          },
          downstream: [],
        },
        createCtx(tmp),
      )
      const saved = expectSaved(out)

      expect(saved.filename).toBe('my-Amazing Title.txt')
      const savedContent = await readFile(saved.filePath, 'utf-8')
      expect(JSON.parse(savedContent)).toEqual({ title: 'Amazing Title', content: 'hello' })
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  it('uses the default captures directory under the workspace', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'oc-test-'))
    try {
      const out = await outputCapturerExecutor.run(
        {
          nodeId: 'n1',
          config: {},
          upstream: {
            node0: { ok: true },
          },
          downstream: [],
        },
        createCtx(tmp),
      )
      const saved = expectSaved(out)

      expect(saved.filePath.startsWith(join(tmp, '.anubis', 'captures'))).toBe(true)
      expect(saved.filename).toMatch(/^output-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/)
      const savedContent = await readFile(saved.filePath, 'utf-8')
      expect(JSON.parse(savedContent)).toEqual({ ok: true })
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  it('sanitizes title placeholders so upstream titles cannot create path segments', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'oc-test-'))
    try {
      const out = await outputCapturerExecutor.run(
        {
          nodeId: 'n1',
          config: {
            outputPath: tmp,
            filename: '{title}',
            extension: 'txt',
          },
          upstream: {
            node0: { title: 'a/b:c', value: 1 },
          },
          downstream: [],
        },
        createCtx(tmp),
      )
      const saved = expectSaved(out)

      expect(saved.filename).toBe('a-b-c.txt')
      expect(saved.filePath).toBe(join(tmp, 'a-b-c.txt'))
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  it('handles write failure gracefully by returning error output', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'oc-test-'))
    try {
      const fileAsDirectory = join(tmp, 'not-a-directory')
      await writeFile(fileAsDirectory, 'already a file')

      const out = await outputCapturerExecutor.run(
        {
          nodeId: 'n1',
          config: {
            outputPath: fileAsDirectory,
            filename: 'test',
            extension: 'txt',
          },
          upstream: {
            node0: 'hello',
          },
          downstream: [],
        },
        createCtx(),
      )
      const failed = expectError(out)

      expect(failed.error.length).toBeGreaterThan(0)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
