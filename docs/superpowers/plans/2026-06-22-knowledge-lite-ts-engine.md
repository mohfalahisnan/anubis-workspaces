# Knowledge Lite TS Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the external `anubis-engine` Rust binary with an in-backend TypeScript port of the anubis-lite markdown engine, hosted over the existing `/knowledge-base/*` HTTP routes, so agents retrieve cited context on demand.

**Architecture:** A new pure package `@anubis/knowledge-lite` (chunking, inverted-index, BM25 search, sqlite store via `better-sqlite3`) is consumed by the backend, which owns per-project path resolution and the HTTP routes. The agent already receives the backend URL in its system prompt; an auto-inject skill + instruction pointer tell it to search-then-cite. The old Rust engine, its `engineBinaryPath` setting, and the automatic context-pack injection are removed.

**Tech Stack:** TypeScript (ESM, `strict`, `isolatedModules`), `better-sqlite3` (already a root dependency), Hono (backend routes), Zod (request validation), Vitest (tests). React/Tailwind for the frontend repoint.

**Source of truth for the port:** `C:\Projects\anubis-lite\scripts\engine_*.py`. The TS port drops graph, lessons, and the plugin-update machinery (v1 scope = search + write ops). Single `knowledge` scope only.

**Branch:** `feat/knowledge-lite-ts-engine` (already created).

---

## Conventions for every task

- Run commands from the repo root unless noted. Node >= 22, pnpm.
- Run a single package's tests with: `pnpm --filter @anubis/knowledge-lite test`
- Vitest resolves `@anubis/*` to built `dist/`, so **rebuild a package after changing it before a downstream package's tests** (`pnpm --filter @anubis/knowledge-lite build`).
- Commit after each task with the message shown. Stay on `feat/knowledge-lite-ts-engine`.
- All new source files are ESM with `import`/`export`; relative imports inside the package use **explicit `.js` extensions** (matches the repo's `isolatedModules` convention, e.g. `import { x } from './config.js'`).

---

# Phase A — `@anubis/knowledge-lite` package

## Task A1: Scaffold the package

**Files:**
- Create: `packages/knowledge-lite/package.json`
- Create: `packages/knowledge-lite/tsconfig.json`
- Create: `packages/knowledge-lite/vitest.config.ts`
- Create: `packages/knowledge-lite/src/index.ts` (temporary stub)
- Modify: root `package.json` (add `better-sqlite3` is already present; nothing to add here yet — confirmed in Task D1)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@anubis/knowledge-lite",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "typescript": "^5.7.3",
    "vitest": "^3.0.5"
  }
}
```

Note: match the exact `better-sqlite3`, `typescript`, and `vitest` versions already used elsewhere in the monorepo. Run `node -e "console.log(require('./package.json').dependencies['better-sqlite3'])"` at the repo root and align the version; do the same for `typescript`/`vitest` by checking `packages/backend/package.json`.

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules", "src/**/*.test.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 4: Create the stub `src/index.ts`**

```ts
export const PLACEHOLDER = true
```

- [ ] **Step 5: Install and build**

Run: `pnpm install`
Then: `pnpm --filter @anubis/knowledge-lite build`
Expected: `dist/index.js` created, no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/knowledge-lite pnpm-lock.yaml
git commit -m "feat(knowledge-lite): scaffold @anubis/knowledge-lite package"
```

---

## Task A2: Config and shared types

**Files:**
- Create: `packages/knowledge-lite/src/config.ts`
- Create: `packages/knowledge-lite/src/types.ts`

- [ ] **Step 1: Write `config.ts`** (ports `engine_constants.py` BM25 params, defaults, schema, stopwords)

```ts
/* Ports the static configuration from anubis-lite engine_constants.py.
   Graph / lessons / plugin-update constants are intentionally omitted (v1 scope). */

export const INDEX_VERSION = 2

// BM25 + phrase/proximity ranking (query-time; changing these never needs an INDEX_VERSION bump)
export const BM25_K1 = 1.5
export const BM25_B = 0.75
export const HEADING_BOOST = 0.3
export const PROX_GAIN = 0.35
export const SEARCH_POOL_MULTIPLIER = 4
export const SEARCH_POOL_MIN = 25
export const CONF_COVERAGE_MIN = 0.5
export const CONF_SCORE_FLOOR = 1.0

// Benchmark (parity test only)
export const BENCHMARK_PROBE_TERMS = 3
export const BENCHMARK_DEPTH = 10

export interface EngineConfig {
  chunkTargetTokens: number
  chunkMaxTokens: number
  searchResultLimit: number
  searchExcerptLinesBefore: number
  searchExcerptLinesAfter: number
}

export const DEFAULT_CONFIG: EngineConfig = {
  chunkTargetTokens: 700,
  chunkMaxTokens: 900,
  searchResultLimit: 8,
  searchExcerptLinesBefore: 2,
  searchExcerptLinesAfter: 2,
}

export const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'also', 'am',
  'an', 'and', 'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before',
  'being', 'below', 'between', 'both', 'but', 'by', 'can', 'could', 'did',
  'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from',
  'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers',
  'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just',
  'me', 'more', 'most', 'my', 'no', 'nor', 'not', 'now', 'of', 'off', 'on',
  'once', 'only', 'or', 'other', 'our', 'out', 'over', 'own', 'same', 'she',
  'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too',
  'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when',
  'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'you',
  'your',
])

export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  title TEXT,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  heading TEXT,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  token_estimate INTEGER,
  content_hash TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id),
  UNIQUE(document_id, chunk_index)
);

CREATE TABLE terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk_id INTEGER NOT NULL,
  term TEXT NOT NULL,
  frequency INTEGER NOT NULL,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id),
  UNIQUE(chunk_id, term)
);

CREATE INDEX idx_terms_term ON terms(term);
CREATE INDEX idx_documents_path ON documents(path);
CREATE INDEX idx_chunks_document_id ON chunks(document_id);
`
```

- [ ] **Step 2: Write `types.ts`**

```ts
export interface Chunk {
  sourcePath: string
  chunkIndex: number
  heading: string | null
  startLine: number
  endLine: number
  tokenEstimate: number
  contentHash: string
  terms: Map<string, number>
  text?: string
}

export interface DocumentRow {
  path: string
  title: string
  contentHash: string
  updatedAt: string
}

export interface SearchResult {
  source: string
  startLine: number
  endLine: number
  heading: string | null
  rawScore: number
  coverage: number
  score: number
  excerpt: string
}

export class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ValidationError' }
}
export class IndexStoreError extends Error {
  constructor(message: string) { super(message); this.name = 'IndexStoreError' }
}
export class FileSystemError extends Error {
  constructor(message: string) { super(message); this.name = 'FileSystemError' }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @anubis/knowledge-lite typecheck`
Expected: PASS (no emit errors).

- [ ] **Step 4: Commit**

```bash
git add packages/knowledge-lite/src
git commit -m "feat(knowledge-lite): config, schema, and shared types"
```

---

## Task A3: Text normalization

**Files:**
- Create: `packages/knowledge-lite/src/text.ts`
- Test: `packages/knowledge-lite/src/text.test.ts`

Ports `normalize_terms`, `stem_term`, `estimate_tokens`, `clean_heading`, `title_from_text` from `engine_index.py`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { normalizeTerms, stemTerm, estimateTokens, cleanHeading, titleFromText } from './text.js'

describe('normalizeTerms', () => {
  it('drops short tokens and stopwords, lowercases, stems', () => {
    expect(normalizeTerms('We Build Workflows and Automations')).toEqual(
      ['build', 'workflow', 'automation'],
    )
  })
  it('stems plurals/inflections consistently', () => {
    expect(stemTerm('workflows')).toBe('workflow')
    expect(stemTerm('automations')).toBe('automation')
    expect(stemTerm('running')).toBe('runn')
  })
})

describe('estimateTokens', () => {
  it('is words * 1.3, min 1', () => {
    expect(estimateTokens('one two three')).toBe(3) // 3 * 1.3 = 3.9 -> int 3
    expect(estimateTokens('')).toBe(1)
  })
})

describe('cleanHeading / titleFromText', () => {
  it('extracts the first markdown heading', () => {
    expect(cleanHeading('## Hello World')).toBe('Hello World')
    expect(cleanHeading('not a heading')).toBeNull()
    expect(titleFromText('a.md', 'intro\n\n# Real Title\nbody')).toBe('Real Title')
    expect(titleFromText('a.md', 'no heading here')).toBe('a.md')
  })
})
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm --filter @anubis/knowledge-lite test`
Expected: FAIL ("Cannot find module './text.js'").

- [ ] **Step 3: Write `text.ts`**

```ts
import { basename } from 'node:path'
import { STOP_WORDS } from './config.js'

const TOKEN_RE = /[A-Za-z0-9]+/g

export function stemTerm(token: string): string {
  // Light suffix stripping, no dependency. Applied identically at index and query
  // time so plural/inflected forms match. Order matters (longest suffixes first).
  for (const suffix of ['ing', 'ed', 'ly', 'es', 's']) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) {
      return token.slice(0, token.length - suffix.length)
    }
  }
  return token
}

export function normalizeTerms(text: string): string[] {
  const terms: string[] = []
  const matches = text.toLowerCase().match(TOKEN_RE) ?? []
  for (const token of matches) {
    if (token.length < 3) continue
    if (STOP_WORDS.has(token)) continue
    const stemmed = stemTerm(token)
    if (STOP_WORDS.has(stemmed)) continue
    terms.push(stemmed)
  }
  return terms
}

export function estimateTokens(text: string): number {
  const wordCount = (text.match(/\S+/g) ?? []).length
  return Math.max(1, Math.trunc(wordCount * 1.3))
}

export function cleanHeading(line: string): string | null {
  const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)
  if (!match) return null
  const heading = match[1].trim()
  return heading || null
}

export function titleFromText(path: string, text: string): string {
  for (const line of text.split('\n')) {
    const heading = cleanHeading(line)
    if (heading) return heading
  }
  return basename(path)
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm --filter @anubis/knowledge-lite test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge-lite/src/text.ts packages/knowledge-lite/src/text.test.ts
git commit -m "feat(knowledge-lite): text normalization (stem, tokens, headings)"
```

---

## Task A4: Chunking

**Files:**
- Create: `packages/knowledge-lite/src/chunking.ts`
- Test: `packages/knowledge-lite/src/chunking.test.ts`

Ports `split_sections`, `paragraph_blocks`, `make_chunk`, `chunks_for_file`, `sha256Text` from `engine_index.py`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { chunksForFile, splitSections } from './chunking.js'
import { DEFAULT_CONFIG } from './config.js'

describe('splitSections', () => {
  it('splits by headings and keeps line ranges', () => {
    const lines = ['# A', 'alpha', '', '## B', 'beta']
    const sections = splitSections(lines, 'f.md')
    expect(sections.map(s => s.heading)).toEqual(['A', 'B'])
    expect(sections[0].startLine).toBe(1)
    expect(sections[1].startLine).toBe(4)
  })
  it('uses the file name as the heading when there are no headings', () => {
    const sections = splitSections(['just', 'body'], 'f.md')
    expect(sections).toHaveLength(1)
    expect(sections[0].heading).toBe('f.md')
    expect(sections[0].endLine).toBe(2)
  })
})

describe('chunksForFile', () => {
  it('produces one chunk for a small section with normalized terms', () => {
    const chunks = chunksForFile('a.md', '# Work\n\nalpha beta alpha', DEFAULT_CONFIG)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].heading).toBe('Work')
    expect(chunks[0].terms.get('alpha')).toBe(2)
    expect(chunks[0].startLine).toBe(1)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm --filter @anubis/knowledge-lite test`
Expected: FAIL ("Cannot find module './chunking.js'").

- [ ] **Step 3: Write `chunking.ts`**

```ts
import { createHash } from 'node:crypto'
import type { EngineConfig } from './config.js'
import type { Chunk } from './types.js'
import { cleanHeading, estimateTokens, normalizeTerms } from './text.js'

export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

interface Section {
  heading: string
  startLine: number
  endLine: number
  lines: string[]
}

export function splitSections(lines: string[], fileName: string): Section[] {
  const headings: Array<[number, string]> = []
  lines.forEach((line, index) => {
    const heading = cleanHeading(line)
    if (heading) headings.push([index, heading])
  })
  if (lines.length === 0) {
    return [{ heading: fileName, startLine: 1, endLine: 1, lines: [] }]
  }
  if (headings.length === 0) {
    return [{ heading: fileName, startLine: 1, endLine: lines.length, lines }]
  }
  const sections: Section[] = []
  if (headings[0][0] > 0) {
    const prefix = lines.slice(0, headings[0][0])
    if (prefix.some(line => line.trim() !== '')) {
      sections.push({ heading: fileName, startLine: 1, endLine: headings[0][0], lines: prefix })
    }
  }
  headings.forEach(([startIndex, heading], idx) => {
    const endIndex = idx + 1 < headings.length ? headings[idx + 1][0] : lines.length
    sections.push({
      heading,
      startLine: startIndex + 1,
      endLine: endIndex,
      lines: lines.slice(startIndex, endIndex),
    })
  })
  return sections
}

type Block = [number, number, string[]] // startLine, endLine, lines

function paragraphBlocks(section: Section): Block[] {
  const { lines, startLine } = section
  const blocks: Block[] = []
  let blockLines: string[] = []
  let blockStart: number | null = null
  let lastLine = startLine
  lines.forEach((line, offset) => {
    const lineNumber = startLine + offset
    if (line.trim() === '') {
      if (blockLines.length) {
        blockLines.push(line)
        blocks.push([blockStart as number, lineNumber, [...blockLines]])
        blockLines = []
        blockStart = null
      }
      return
    }
    if (blockStart === null) blockStart = lineNumber
    blockLines.push(line)
    lastLine = lineNumber
  })
  if (blockLines.length) blocks.push([blockStart as number, lastLine, [...blockLines]])
  if (blocks.length === 0) blocks.push([section.startLine, section.endLine, lines])
  return blocks
}

function makeChunk(
  sourcePath: string,
  chunkIndex: number,
  heading: string | null,
  startLine: number | null,
  endLine: number | null,
  text: string,
): Chunk {
  const fullText = heading ? `${heading}\n${text}` : text
  const terms = new Map<string, number>()
  for (const term of normalizeTerms(fullText)) {
    terms.set(term, (terms.get(term) ?? 0) + 1)
  }
  const start = startLine || 1
  return {
    sourcePath,
    chunkIndex,
    heading,
    startLine: start,
    endLine: endLine || start,
    tokenEstimate: estimateTokens(text),
    contentHash: sha256Text(text),
    terms,
    text,
  }
}

export function chunksForFile(sourcePath: string, text: string, config: EngineConfig): Chunk[] {
  const lines = text.split('\n')
  const fileName = sourcePath.split('/').pop() ?? sourcePath
  const chunks: Chunk[] = []
  let chunkIndex = 0
  for (const section of splitSections(lines, fileName)) {
    const sectionText = section.lines.join('\n')
    if (estimateTokens(sectionText) <= config.chunkMaxTokens) {
      chunks.push(makeChunk(sourcePath, chunkIndex++, section.heading, section.startLine, section.endLine, sectionText))
      continue
    }
    let currentLines: string[] = []
    let currentStart: number | null = null
    let currentEnd: number | null = null
    for (const [blockStart, blockEnd, blockLines] of paragraphBlocks(section)) {
      const proposed = [...currentLines, ...blockLines]
      if (currentLines.length && estimateTokens(proposed.join('\n')) > config.chunkTargetTokens) {
        chunks.push(makeChunk(sourcePath, chunkIndex++, section.heading, currentStart, currentEnd, currentLines.join('\n')))
        currentLines = [...blockLines]
        currentStart = blockStart
        currentEnd = blockEnd
      } else {
        if (currentStart === null) currentStart = blockStart
        currentLines.push(...blockLines)
        currentEnd = blockEnd
      }
    }
    if (currentLines.length) {
      chunks.push(makeChunk(sourcePath, chunkIndex++, section.heading, currentStart, currentEnd, currentLines.join('\n')))
    }
  }
  return chunks
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm --filter @anubis/knowledge-lite test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge-lite/src/chunking.ts packages/knowledge-lite/src/chunking.test.ts
git commit -m "feat(knowledge-lite): section-aware chunking"
```

---

## Task A5: Filesystem scanning & source paths

**Files:**
- Create: `packages/knowledge-lite/src/fs.ts`
- Test: `packages/knowledge-lite/src/fs.test.ts`

The engine package takes an explicit `sourceRoot` (the directory holding markdown — in the app this is `<workspace>/knowledge`). Source paths are stored **relative to `sourceRoot`** with forward slashes (e.g. `brand/voice.md`). This is the v1 simplification of the Python `documents/` layout.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanMarkdownFiles, toSourcePath, utcNow } from './fs.js'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'kl-fs-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('scanMarkdownFiles', () => {
  it('finds nested .md files sorted by relative path, ignores non-md', () => {
    mkdirSync(join(root, 'brand'), { recursive: true })
    writeFileSync(join(root, 'brand', 'voice.md'), '# V')
    writeFileSync(join(root, 'a.md'), '# A')
    writeFileSync(join(root, 'note.txt'), 'x')
    const files = scanMarkdownFiles(root)
    expect(files.map(f => toSourcePath(root, f))).toEqual(['a.md', 'brand/voice.md'])
  })
  it('returns [] when sourceRoot is missing', () => {
    expect(scanMarkdownFiles(join(root, 'nope'))).toEqual([])
  })
})

describe('utcNow', () => {
  it('is an ISO Z timestamp', () => {
    expect(utcNow()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm --filter @anubis/knowledge-lite test`
Expected: FAIL ("Cannot find module './fs.js'").

- [ ] **Step 3: Write `fs.ts`**

```ts
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** ISO-8601 UTC timestamp, seconds precision, e.g. 2026-06-22T10:00:00Z. */
export function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** Source path relative to sourceRoot, forward-slashed, e.g. "brand/voice.md". */
export function toSourcePath(sourceRoot: string, absPath: string): string {
  return relative(sourceRoot, absPath).split(sep).join('/')
}

/** All *.md files under sourceRoot (recursive), sorted by lowercased relative path. */
export function scanMarkdownFiles(sourceRoot: string): string[] {
  if (!existsSync(sourceRoot)) return []
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(abs)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        out.push(abs)
      }
    }
  }
  walk(sourceRoot)
  out.sort((a, b) => toSourcePath(sourceRoot, a).toLowerCase().localeCompare(toSourcePath(sourceRoot, b).toLowerCase()))
  return out
}

/** True when path is a directory (false if it does not exist). */
export function isDirectory(p: string): boolean {
  try { return statSync(p).isDirectory() } catch { return false }
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm --filter @anubis/knowledge-lite test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge-lite/src/fs.ts packages/knowledge-lite/src/fs.test.ts
git commit -m "feat(knowledge-lite): markdown scanning and source-path helpers"
```

---

## Task A6: SQLite index store (incremental build + read)

**Files:**
- Create: `packages/knowledge-lite/src/index-store.ts`
- Test: `packages/knowledge-lite/src/index-store.test.ts`

Ports `build_index` (incremental reuse), `load_reusable_chunks`, `read_chunks_from_db`, `current_document_hashes`, `index_is_fresh` from `engine_index.py`.

- [ ] **Step 1: Write the failing test** (ports `IncrementalIngestTests`)

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { buildIndex, readChunksFromDb, indexIsFresh } from './index-store.js'
import { DEFAULT_CONFIG, INDEX_VERSION } from './config.js'

let src: string
let db: string
beforeEach(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'kl-store-'))
  src = join(tmp, 'knowledge')
  db = join(tmp, 'index.db')
  mkdirSync(src, { recursive: true })
})
afterEach(() => { rmSync(join(src, '..'), { recursive: true, force: true }) })

function write(rel: string, text: string): void {
  const p = join(src, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, text, 'utf8')
}

function snapshot(): unknown {
  const conn = new Database(db, { readonly: true })
  try {
    return {
      docs: conn.prepare('SELECT path, title, content_hash FROM documents ORDER BY path').all(),
      chunks: conn.prepare('SELECT d.path, c.chunk_index, c.heading, c.start_line, c.end_line, c.token_estimate, c.content_hash FROM chunks c JOIN documents d ON d.id = c.document_id ORDER BY d.path, c.chunk_index').all(),
      terms: conn.prepare('SELECT d.path, c.chunk_index, t.term, t.frequency FROM terms t JOIN chunks c ON c.id = t.chunk_id JOIN documents d ON d.id = c.document_id ORDER BY d.path, c.chunk_index, t.term').all(),
    }
  } finally { conn.close() }
}

describe('buildIndex', () => {
  it('incremental result equals a full rebuild after change/add/delete', () => {
    write('a.md', '# A\n\nalpha shared word\n')
    write('b.md', '# B\n\nbeta shared word\n')
    write('c.md', '# C\n\ngamma shared word\n')
    buildIndex(src, db, DEFAULT_CONFIG)
    write('a.md', '# A\n\nalpha shared word extra epsilon\n')
    write('d.md', '# D\n\ndelta shared word\n')
    rmSync(join(src, 'c.md'))
    buildIndex(src, db, DEFAULT_CONFIG)
    const incremental = snapshot()

    // Fresh full rebuild of the final file set in a second store.
    const tmp2 = mkdtempSync(join(tmpdir(), 'kl-store2-'))
    const src2 = join(tmp2, 'knowledge'); const db2 = join(tmp2, 'index.db')
    mkdirSync(src2, { recursive: true })
    const w2 = (rel: string, t: string) => { const p = join(src2, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t, 'utf8') }
    w2('a.md', '# A\n\nalpha shared word extra epsilon\n')
    w2('b.md', '# B\n\nbeta shared word\n')
    w2('d.md', '# D\n\ndelta shared word\n')
    buildIndex(src2, db2, DEFAULT_CONFIG, true)
    const conn = new Database(db2, { readonly: true })
    const full = {
      docs: conn.prepare('SELECT path, title, content_hash FROM documents ORDER BY path').all(),
      chunks: conn.prepare('SELECT d.path, c.chunk_index, c.heading, c.start_line, c.end_line, c.token_estimate, c.content_hash FROM chunks c JOIN documents d ON d.id = c.document_id ORDER BY d.path, c.chunk_index').all(),
      terms: conn.prepare('SELECT d.path, c.chunk_index, t.term, t.frequency FROM terms t JOIN chunks c ON c.id = t.chunk_id JOIN documents d ON d.id = c.document_id ORDER BY d.path, c.chunk_index, t.term').all(),
    }
    conn.close()
    rmSync(tmp2, { recursive: true, force: true })

    expect(incremental).toEqual(full)
  })

  it('sets user_version and indexIsFresh tracks file hashes', () => {
    write('a.md', '# A\n\nalpha content here\n')
    buildIndex(src, db, DEFAULT_CONFIG)
    const conn = new Database(db, { readonly: true })
    expect(conn.pragma('user_version', { simple: true })).toBe(INDEX_VERSION)
    conn.close()
    expect(indexIsFresh(src, db)).toBe(true)
    write('a.md', '# A\n\nalpha content here changed\n')
    expect(indexIsFresh(src, db)).toBe(false)
  })

  it('readChunksFromDb returns docs and chunks with terms', () => {
    write('a.md', '# A\n\nalpha beta alpha\n')
    buildIndex(src, db, DEFAULT_CONFIG)
    const { documents, chunks } = readChunksFromDb(db)
    expect(documents).toHaveLength(1)
    expect(chunks[0].terms.get('alpha')).toBe(2)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm --filter @anubis/knowledge-lite test`
Expected: FAIL ("Cannot find module './index-store.js'").

- [ ] **Step 3: Write `index-store.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import type { EngineConfig } from './config.js'
import { INDEX_VERSION, SCHEMA_SQL } from './config.js'
import type { Chunk, DocumentRow } from './types.js'
import { FileSystemError, IndexStoreError } from './types.js'
import { chunksForFile, sha256Text } from './chunking.js'
import { titleFromText } from './text.js'
import { scanMarkdownFiles, toSourcePath, utcNow } from './fs.js'

interface ReusableEntry {
  contentHash: string
  title: string
  updatedAt: string
  chunks: Chunk[]
}

export function readChunksFromDb(dbPath: string): { documents: DocumentRow[]; chunks: Chunk[] } {
  let conn: Database.Database
  try {
    conn = new Database(dbPath, { readonly: true })
  } catch (err) {
    throw new IndexStoreError(`could not open sqlite index: ${String(err)}`)
  }
  try {
    const docRows = conn.prepare('SELECT path, title, content_hash, updated_at FROM documents ORDER BY path').all() as Array<{ path: string; title: string; content_hash: string; updated_at: string }>
    const rows = conn.prepare(`
      SELECT d.path AS source_path, c.chunk_index, c.heading, c.start_line, c.end_line,
             c.token_estimate, c.content_hash, t.term, t.frequency
      FROM documents d
      JOIN chunks c ON c.document_id = d.id
      LEFT JOIN terms t ON t.chunk_id = c.id
      ORDER BY d.path, c.chunk_index, t.term
    `).all() as Array<{ source_path: string; chunk_index: number; heading: string | null; start_line: number; end_line: number; token_estimate: number; content_hash: string; term: string | null; frequency: number | null }>

    const documents: DocumentRow[] = docRows.map(r => ({ path: r.path, title: r.title, contentHash: r.content_hash, updatedAt: r.updated_at }))
    const chunkMap = new Map<string, Chunk>()
    for (const row of rows) {
      const key = `${row.source_path} ${row.chunk_index}`
      let chunk = chunkMap.get(key)
      if (!chunk) {
        chunk = {
          sourcePath: row.source_path,
          chunkIndex: row.chunk_index,
          heading: row.heading,
          startLine: row.start_line,
          endLine: row.end_line,
          tokenEstimate: row.token_estimate,
          contentHash: row.content_hash,
          terms: new Map<string, number>(),
        }
        chunkMap.set(key, chunk)
      }
      if (row.term) chunk.terms.set(row.term, row.frequency as number)
    }
    const chunks = [...chunkMap.values()].sort(
      (a, b) => a.sourcePath.localeCompare(b.sourcePath) || a.chunkIndex - b.chunkIndex,
    )
    return { documents, chunks }
  } catch (err) {
    throw new IndexStoreError(`could not read sqlite index: ${String(err)}`)
  } finally {
    conn.close()
  }
}

function loadReusableChunks(dbPath: string): Map<string, ReusableEntry> {
  const empty = new Map<string, ReusableEntry>()
  if (!existsSync(dbPath)) return empty
  try {
    const probe = new Database(dbPath, { readonly: true })
    const version = probe.pragma('user_version', { simple: true }) as number
    probe.close()
    if (version !== INDEX_VERSION) return empty
  } catch { return empty }
  let documents: DocumentRow[]
  let chunks: Chunk[]
  try {
    ;({ documents, chunks } = readChunksFromDb(dbPath))
  } catch { return empty }
  const byPath = new Map<string, ReusableEntry>()
  for (const doc of documents) {
    byPath.set(doc.path, { contentHash: doc.contentHash, title: doc.title, updatedAt: doc.updatedAt, chunks: [] })
  }
  for (const chunk of chunks) {
    byPath.get(chunk.sourcePath)?.chunks.push(chunk)
  }
  for (const entry of byPath.values()) entry.chunks.sort((a, b) => a.chunkIndex - b.chunkIndex)
  return byPath
}

export function buildIndex(sourceRoot: string, dbPath: string, config: EngineConfig, full = false): { documents: number; chunks: number } {
  const generatedAt = utcNow()
  const current: Array<{ sourcePath: string; contentHash: string; text: string }> = []
  for (const abs of scanMarkdownFiles(sourceRoot)) {
    let text: string
    try {
      text = readFileSync(abs, 'utf8')
    } catch (err) {
      throw new FileSystemError(`could not read markdown file ${abs}: ${String(err)}`)
    }
    current.push({ sourcePath: toSourcePath(sourceRoot, abs), contentHash: sha256Text(text), text })
  }

  const reuse = full ? new Map<string, ReusableEntry>() : loadReusableChunks(dbPath)
  const docs: DocumentRow[] = []
  const chunks: Chunk[] = []
  for (const { sourcePath, contentHash, text } of current) {
    const cached = reuse.get(sourcePath)
    if (cached && cached.contentHash === contentHash) {
      docs.push({ path: sourcePath, title: cached.title, contentHash, updatedAt: cached.updatedAt })
      chunks.push(...cached.chunks)
    } else {
      docs.push({ path: sourcePath, title: titleFromText(sourcePath, text), contentHash, updatedAt: generatedAt })
      chunks.push(...chunksForFile(sourcePath, text, config))
    }
  }

  mkdirSync(dirname(dbPath), { recursive: true })
  const tmpPath = join(dirname(dbPath), `${dbPath.split(/[\\/]/).pop()}.${process.pid}.tmp`)
  try {
    if (existsSync(tmpPath)) rmSync(tmpPath, { force: true })
    const conn = new Database(tmpPath)
    try {
      conn.pragma('foreign_keys = ON')
      conn.exec(SCHEMA_SQL)
      conn.pragma(`user_version = ${INDEX_VERSION}`)
      const insertDoc = conn.prepare('INSERT INTO documents(path, title, content_hash, updated_at) VALUES (?, ?, ?, ?)')
      const insertChunk = conn.prepare('INSERT INTO chunks(document_id, chunk_index, heading, start_line, end_line, token_estimate, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
      const insertTerm = conn.prepare('INSERT INTO terms(chunk_id, term, frequency) VALUES (?, ?, ?)')
      const run = conn.transaction(() => {
        const docIds = new Map<string, number>()
        for (const doc of docs) {
          const info = insertDoc.run(doc.path, doc.title, doc.contentHash, doc.updatedAt)
          docIds.set(doc.path, Number(info.lastInsertRowid))
        }
        for (const chunk of chunks) {
          const info = insertChunk.run(
            docIds.get(chunk.sourcePath), chunk.chunkIndex, chunk.heading,
            chunk.startLine, chunk.endLine, chunk.tokenEstimate, chunk.contentHash,
          )
          const chunkId = Number(info.lastInsertRowid)
          for (const term of [...chunk.terms.keys()].sort()) {
            insertTerm.run(chunkId, term, chunk.terms.get(term))
          }
        }
      })
      run()
    } finally {
      conn.close()
    }
    renameSync(tmpPath, dbPath)
  } catch (err) {
    try { if (existsSync(tmpPath)) rmSync(tmpPath, { force: true }) } catch { /* ignore */ }
    throw new IndexStoreError(`could not rebuild sqlite index: ${String(err)}`)
  }
  return { documents: docs.length, chunks: chunks.length }
}

export function currentDocumentHashes(sourceRoot: string): Map<string, string> {
  const hashes = new Map<string, string>()
  for (const abs of scanMarkdownFiles(sourceRoot)) {
    let text: string
    try {
      text = readFileSync(abs, 'utf8')
    } catch (err) {
      throw new FileSystemError(`could not read markdown file ${abs}: ${String(err)}`)
    }
    hashes.set(toSourcePath(sourceRoot, abs), sha256Text(text))
  }
  return hashes
}

export function indexIsFresh(sourceRoot: string, dbPath: string): boolean {
  if (!existsSync(dbPath)) return false
  const current = currentDocumentHashes(sourceRoot)
  let stored: Map<string, string>
  try {
    const conn = new Database(dbPath, { readonly: true })
    const rows = conn.prepare('SELECT path, content_hash FROM documents').all() as Array<{ path: string; content_hash: string }>
    conn.close()
    stored = new Map(rows.map(r => [r.path, r.content_hash]))
  } catch { return false }
  if (stored.size !== current.size) return false
  for (const [path, hash] of current) {
    if (stored.get(path) !== hash) return false
  }
  return true
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm --filter @anubis/knowledge-lite test`
Expected: PASS (incremental == full, freshness tracking, term reads).

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge-lite/src/index-store.ts packages/knowledge-lite/src/index-store.test.ts
git commit -m "feat(knowledge-lite): incremental sqlite index store"
```

---

## Task A7: Search (BM25 + phrase + proximity)

**Files:**
- Create: `packages/knowledge-lite/src/search.ts`
- Test: `packages/knowledge-lite/src/search.test.ts`

Ports `parse_query`, `contains_phrase`, `proximity_factor`, `_corpus_stats`, `_query_idf`, `_fetch_candidates`, `search_index`, `excerpt_for_result`, `render_search_result` from `engine_search.py`. Drops the `scope`/lessons parameter (v1).

- [ ] **Step 1: Write the failing test** (ports `Bm25SearchTests` + `LexicalSearchTests`)

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseQuery, containsPhrase, proximityFactor, searchIndex, renderSearchResult } from './search.js'
import { buildIndex } from './index-store.js'
import { DEFAULT_CONFIG } from './config.js'

describe('parseQuery', () => {
  it('no quotes -> phrases empty, terms stemmed', () => {
    const { phrases, terms } = parseQuery('workflow automation')
    expect(phrases).toEqual([])
    expect(new Set(terms)).toEqual(new Set(['workflow', 'automation']))
  })
  it('extracts a phrase and keeps its tokens as terms (deduped)', () => {
    const { phrases, terms } = parseQuery('handling "price objection" fast')
    expect(phrases).toEqual([['price', 'objection']])
    expect(new Set(terms)).toEqual(new Set(['handl', 'price', 'objection', 'fast']))
    expect(terms.length).toBe(new Set(terms).size)
  })
  it('normalizes stopwords out of a phrase', () => {
    const { phrases, terms } = parseQuery('"out of stock"')
    expect(phrases).toEqual([['stock']])
    expect(terms).toEqual(['stock'])
  })
})

describe('containsPhrase', () => {
  it('requires adjacent, in-order tokens', () => {
    expect(containsPhrase(['a', 'price', 'objection', 'b'], ['price', 'objection'])).toBe(true)
    expect(containsPhrase(['a', 'objection', 'x', 'price'], ['price', 'objection'])).toBe(false)
    expect(containsPhrase(['anything'], [])).toBe(true)
  })
})

describe('proximityFactor', () => {
  it('adjacent beats scattered, single term is zero', () => {
    const near = proximityFactor(['alpha', 'beta', 'x', 'y', 'z'], ['alpha', 'beta'])
    const far = proximityFactor(['alpha', 'x', 'y', 'z', 'beta'], ['alpha', 'beta'])
    expect(near).toBeGreaterThan(far)
    expect(near).toBeLessThanOrEqual(1)
    expect(proximityFactor(['alpha', 'x', 'alpha'], ['alpha', 'beta'])).toBe(0)
  })
})

describe('searchIndex', () => {
  let src: string; let db: string
  beforeEach(() => { const tmp = mkdtempSync(join(tmpdir(), 'kl-search-')); src = join(tmp, 'k'); db = join(tmp, 'i.db'); mkdirSync(src, { recursive: true }) })
  afterEach(() => { rmSync(join(src, '..'), { recursive: true, force: true }) })
  const write = (rel: string, t: string) => { const p = join(src, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t, 'utf8') }
  const index = (files: Record<string, string>) => { for (const [k, v] of Object.entries(files)) write(k, v); buildIndex(src, db, DEFAULT_CONFIG) }

  it('matches stemmed plural forms', () => {
    index({ 'w.md': '# Work\n\nwe build workflows and automations every morning\n' })
    const r = searchIndex(src, db, 'workflow automation', DEFAULT_CONFIG)
    expect(r[0].source).toBe('w.md')
  })
  it('full coverage outranks high-frequency partial', () => {
    index({ 'a.md': '# A\n\napple banana\n', 'b.md': '# B\n\napple apple apple apple apple apple\n' })
    const r = searchIndex(src, db, 'apple banana', DEFAULT_CONFIG)
    expect(r[0].source).toBe('a.md')
  })
  it('rare term outranks common term (IDF)', () => {
    index({
      'rare.md': '# Rare\n\nzebra padding word\n', 'common.md': '# Common\n\nalpha padding word\n',
      'x1.md': '# X1\n\nalpha filler\n', 'x2.md': '# X2\n\nalpha filler\n', 'x3.md': '# X3\n\nalpha filler\n',
    })
    const paths = searchIndex(src, db, 'zebra alpha', DEFAULT_CONFIG).map(r => r.source)
    expect(paths.indexOf('rare.md')).toBeLessThan(paths.indexOf('common.md'))
  })
  it('shorter chunk outranks longer with equal tf', () => {
    index({ 'short.md': '# Short\n\nmango mango\n', 'long.md': '# Long\n\nmango mango ' + 'filler '.repeat(40) + '\n' })
    expect(searchIndex(src, db, 'mango', DEFAULT_CONFIG)[0].source).toBe('short.md')
  })
  it('proximity orders adjacent above scattered', () => {
    index({ 'near.md': '# Near\n\nalpha beta padding padding padding padding\n', 'far.md': '# Far\n\nalpha padding padding beta padding padding\n' })
    expect(searchIndex(src, db, 'alpha beta', DEFAULT_CONFIG)[0].source).toBe('near.md')
  })
  it('quoted phrase excludes scattered match', () => {
    index({ 'hit.md': '# Hit\n\nprice objection handling tips\n', 'miss.md': '# Miss\n\nobjection about the price today\n' })
    const paths = searchIndex(src, db, '"price objection"', DEFAULT_CONFIG).map(r => r.source)
    expect(paths).toContain('hit.md')
    expect(paths).not.toContain('miss.md')
  })
  it('normalizes scores to [0,1] with top = 1', () => {
    index({ 'a.md': '# A\n\nalpha beta gamma\n', 'b.md': '# B\n\nalpha delta\n' })
    const r = searchIndex(src, db, 'alpha beta', DEFAULT_CONFIG)
    expect(r[0].score).toBeCloseTo(1.0)
    for (const x of r) { expect(x.score).toBeGreaterThanOrEqual(0); expect(x.score).toBeLessThanOrEqual(1) }
  })
  it('weak top hit renders a Low confidence note', () => {
    index({ 'a.md': '# A\n\nalpha alpha alpha\n', 'b.md': '# B\n\nalpha content\n' })
    const r = searchIndex(src, db, 'alpha beta gamma', DEFAULT_CONFIG)
    expect(r[0].coverage).toBeLessThan(0.5)
    expect(renderSearchResult('alpha beta gamma', r)).toContain('Low confidence')
  })
  it('empty index returns no results', () => {
    index({})
    expect(searchIndex(src, db, 'alpha', DEFAULT_CONFIG)).toEqual([])
  })
})
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm --filter @anubis/knowledge-lite test`
Expected: FAIL ("Cannot find module './search.js'").

- [ ] **Step 3: Write `search.ts`**

```ts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import type { EngineConfig } from './config.js'
import {
  BM25_B, BM25_K1, CONF_COVERAGE_MIN, CONF_SCORE_FLOOR, HEADING_BOOST,
  PROX_GAIN, SEARCH_POOL_MIN, SEARCH_POOL_MULTIPLIER,
} from './config.js'
import type { SearchResult } from './types.js'
import { IndexStoreError } from './types.js'
import { normalizeTerms } from './text.js'

export function parseQuery(query: string): { phrases: string[][]; terms: string[] } {
  const phrases: string[][] = []
  const freeChunks: string[] = []
  let last = 0
  const re = /"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(query)) !== null) {
    freeChunks.push(query.slice(last, m.index))
    const tokens = normalizeTerms(m[1])
    if (tokens.length) phrases.push(tokens)
    last = m.index + m[0].length
  }
  freeChunks.push(query.slice(last))
  const terms: string[] = []
  const seen = new Set<string>()
  for (const token of normalizeTerms(freeChunks.join(' '))) {
    if (!seen.has(token)) { seen.add(token); terms.push(token) }
  }
  for (const phrase of phrases) {
    for (const token of phrase) {
      if (!seen.has(token)) { seen.add(token); terms.push(token) }
    }
  }
  return { phrases, terms }
}

export function containsPhrase(tokenStream: string[], phraseTokens: string[]): boolean {
  if (phraseTokens.length === 0) return true
  const span = phraseTokens.length
  if (span > tokenStream.length) return false
  for (let start = 0; start <= tokenStream.length - span; start++) {
    let ok = true
    for (let i = 0; i < span; i++) {
      if (tokenStream[start + i] !== phraseTokens[i]) { ok = false; break }
    }
    if (ok) return true
  }
  return false
}

export function proximityFactor(tokenStream: string[], queryTerms: string[]): number {
  const querySet = new Set(queryTerms)
  const occurrences: Array<[number, string]> = []
  tokenStream.forEach((tok, i) => { if (querySet.has(tok)) occurrences.push([i, tok]) })
  const distinctPresent = new Set(occurrences.map(o => o[1]))
  if (distinctPresent.size < 2) return 0
  const target = distinctPresent.size
  let bestWidth: number | null = null
  const counts = new Map<string, number>()
  let have = 0
  let left = 0
  for (let right = 0; right < occurrences.length; right++) {
    const tok = occurrences[right][1]
    counts.set(tok, (counts.get(tok) ?? 0) + 1)
    if (counts.get(tok) === 1) have++
    while (have === target) {
      const width = occurrences[right][0] - occurrences[left][0]
      if (bestWidth === null || width < bestWidth) bestWidth = width
      const leftTok = occurrences[left][1]
      counts.set(leftTok, (counts.get(leftTok) as number) - 1)
      if (counts.get(leftTok) === 0) have--
      left++
    }
  }
  if (bestWidth === null) return 0
  const tightness = Math.min(1, (target - 1) / bestWidth)
  const coverage = distinctPresent.size / querySet.size
  return coverage * tightness
}

interface CandidateMeta { sourcePath: string; chunkIndex: number; heading: string | null; startLine: number; endLine: number }

function chunkTokenStream(sourceRoot: string, sourcePath: string, startLine: number, endLine: number, cache: Map<string, string[]>): string[] {
  let lines = cache.get(sourcePath)
  if (lines === undefined) {
    try { lines = readFileSync(join(sourceRoot, sourcePath), 'utf8').split('\n') } catch { lines = [] }
    cache.set(sourcePath, lines)
  }
  const start = Math.max(0, startLine - 1)
  return normalizeTerms(lines.slice(start, endLine).join('\n'))
}

export function searchIndex(sourceRoot: string, dbPath: string, query: string, config: EngineConfig): SearchResult[] {
  const { phrases, terms: queryTerms } = parseQuery(query)
  if (queryTerms.length === 0) return []
  if (!existsSync(dbPath)) return []

  let nChunks = 0
  let avgdl = 1
  const lengths = new Map<number, number>()
  const idf = new Map<string, number>()
  const candTerms = new Map<number, Map<string, number>>()
  const candMeta = new Map<number, CandidateMeta>()

  try {
    const conn = new Database(dbPath, { readonly: true })
    try {
      for (const row of conn.prepare('SELECT chunk_id, SUM(frequency) AS len FROM terms GROUP BY chunk_id').all() as Array<{ chunk_id: number; len: number }>) {
        lengths.set(row.chunk_id, row.len)
      }
      nChunks = (conn.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n
      if (!nChunks) return []
      const total = [...lengths.values()].reduce((a, b) => a + b, 0)
      avgdl = nChunks ? total / nChunks : 1
      if (!avgdl) avgdl = 1

      const placeholders = queryTerms.map(() => '?').join(',')
      const dfRows = conn.prepare(`SELECT term, COUNT(DISTINCT chunk_id) AS df FROM terms WHERE term IN (${placeholders}) GROUP BY term`).all(...queryTerms) as Array<{ term: string; df: number }>
      const docFreq = new Map(dfRows.map(r => [r.term, r.df]))
      for (const term of queryTerms) {
        const nT = docFreq.get(term) ?? 0
        idf.set(term, nT ? Math.log(1 + (nChunks - nT + 0.5) / (nT + 0.5)) : 0)
      }

      const candRows = conn.prepare(`
        SELECT c.id AS chunk_id, d.path AS source_path, c.chunk_index, c.heading,
               c.start_line, c.end_line, t.term, t.frequency
        FROM terms t
        JOIN chunks c ON c.id = t.chunk_id
        JOIN documents d ON d.id = c.document_id
        WHERE t.term IN (${placeholders})
      `).all(...queryTerms) as Array<{ chunk_id: number; source_path: string; chunk_index: number; heading: string | null; start_line: number; end_line: number; term: string; frequency: number }>
      for (const row of candRows) {
        let tf = candTerms.get(row.chunk_id)
        if (!tf) { tf = new Map(); candTerms.set(row.chunk_id, tf) }
        tf.set(row.term, row.frequency)
        if (!candMeta.has(row.chunk_id)) {
          candMeta.set(row.chunk_id, { sourcePath: row.source_path, chunkIndex: row.chunk_index, heading: row.heading, startLine: row.start_line, endLine: row.end_line })
        }
      }
    } finally {
      conn.close()
    }
  } catch (err) {
    throw new IndexStoreError(`could not search sqlite index: ${String(err)}`)
  }

  if (candTerms.size === 0) return []

  const totalTerms = queryTerms.length
  const bm25 = new Map<number, number>()
  const matchedCounts = new Map<number, number>()
  for (const [cid, termFreqs] of candTerms) {
    const dl = lengths.get(cid) || 1
    const headingTerms = new Set(normalizeTerms(candMeta.get(cid)!.heading ?? ''))
    let score = 0
    let matched = 0
    for (const term of queryTerms) {
      const freq = termFreqs.get(term) ?? 0
      if (freq) {
        matched++
        const denom = freq + BM25_K1 * (1 - BM25_B + BM25_B * dl / avgdl)
        score += (idf.get(term) as number) * (freq * (BM25_K1 + 1)) / denom
      }
      if (headingTerms.has(term)) score += HEADING_BOOST * (idf.get(term) as number)
    }
    bm25.set(cid, score)
    matchedCounts.set(cid, matched)
  }

  const ordered = [...bm25.keys()].sort((a, b) => {
    const d = (bm25.get(b) as number) - (bm25.get(a) as number)
    if (d !== 0) return d
    const ma = candMeta.get(a)!; const mb = candMeta.get(b)!
    return ma.sourcePath.localeCompare(mb.sourcePath) || ma.startLine - mb.startLine
  })

  const required = new Set<string>()
  for (const phrase of phrases) for (const tok of phrase) required.add(tok)

  let pool: number[]
  if (phrases.length) {
    pool = ordered.filter(cid => [...required].every(tok => (candTerms.get(cid)?.get(tok) ?? 0) > 0))
  } else {
    const poolSize = Math.max(config.searchResultLimit * SEARCH_POOL_MULTIPLIER, SEARCH_POOL_MIN)
    pool = ordered.slice(0, poolSize)
  }

  const fileCache = new Map<string, string[]>()
  const results: SearchResult[] = []
  for (const cid of pool) {
    const meta = candMeta.get(cid)!
    const stream = chunkTokenStream(sourceRoot, meta.sourcePath, meta.startLine, meta.endLine, fileCache)
    if (phrases.length && !phrases.every(phrase => containsPhrase(stream, phrase))) continue
    const factor = proximityFactor(stream, queryTerms)
    const final = (bm25.get(cid) as number) * (1 + PROX_GAIN * factor)
    results.push({
      source: meta.sourcePath,
      startLine: meta.startLine,
      endLine: meta.endLine,
      heading: meta.heading,
      rawScore: final,
      coverage: totalTerms ? (matchedCounts.get(cid) as number) / totalTerms : 0,
      score: 0,
      excerpt: '',
    })
  }

  results.sort((a, b) => (b.rawScore - a.rawScore) || a.source.localeCompare(b.source) || a.startLine - b.startLine)
  const trimmed = results.slice(0, config.searchResultLimit)
  const topRaw = trimmed.length ? trimmed[0].rawScore : 0
  for (const r of trimmed) {
    r.score = topRaw ? r.rawScore / topRaw : 0
    const [start, end, excerpt] = excerptForResult(sourceRoot, r, config)
    r.startLine = start
    r.endLine = end
    r.excerpt = excerpt
  }
  return trimmed
}

function excerptForResult(sourceRoot: string, result: SearchResult, config: EngineConfig): [number, number, string] {
  let sourceLines: string[]
  try {
    sourceLines = readFileSync(join(sourceRoot, result.source), 'utf8').split('\n')
  } catch {
    return [result.startLine, result.endLine, '']
  }
  if (sourceLines.length === 0) return [1, 1, '']
  const start = Math.max(1, result.startLine - config.searchExcerptLinesBefore)
  const end = Math.min(sourceLines.length, result.endLine + config.searchExcerptLinesAfter)
  return [start, end, sourceLines.slice(start - 1, end).join('\n')]
}

export function renderSearchResult(query: string, results: SearchResult[]): string {
  const lines = ['# Search Result', '', `Query: ${query}`, '']
  if (results.length === 0) {
    lines.push('No results found.', '')
    return lines.join('\n')
  }
  const top = results[0]
  if (top.coverage < CONF_COVERAGE_MIN || top.rawScore < CONF_SCORE_FLOOR) {
    lines.push('> Low confidence — the top match is weak; this may not be in the knowledge base.', '')
  }
  results.forEach((result, idx) => {
    lines.push(
      `## Result ${idx + 1}`, '',
      `Source: ${result.source}  `,
      `Lines: ${result.startLine}-${result.endLine}  `,
      `Score: ${result.score.toFixed(2)}`, '',
      'Excerpt:', '', '```md', result.excerpt, '```', '',
    )
  })
  return lines.join('\n')
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm --filter @anubis/knowledge-lite test`
Expected: PASS (all ranking behaviors match the Python tool).

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge-lite/src/search.ts packages/knowledge-lite/src/search.test.ts
git commit -m "feat(knowledge-lite): BM25 + phrase + proximity search"
```

---

## Task A8: Write-op path validation

**Files:**
- Create: `packages/knowledge-lite/src/paths.ts`
- Test: `packages/knowledge-lite/src/paths.test.ts`

Ports `reject_bad_document_path` + `validate_target_path` from `engine_fs.py`, adapted so the corpus root is `sourceRoot` (the `knowledge/` dir) directly.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { rejectBadDocumentPath, resolveTargetPath } from './paths.js'
import { ValidationError } from './types.js'

describe('rejectBadDocumentPath', () => {
  it('accepts a clean relative .md path', () => {
    expect(rejectBadDocumentPath('brand/voice.md')).toBe('brand/voice.md')
  })
  it('rejects empty, absolute, drive, .., and non-md', () => {
    expect(() => rejectBadDocumentPath('')).toThrow(ValidationError)
    expect(() => rejectBadDocumentPath('/etc/x.md')).toThrow(ValidationError)
    expect(() => rejectBadDocumentPath('C:/x.md')).toThrow(ValidationError)
    expect(() => rejectBadDocumentPath('../x.md')).toThrow(ValidationError)
    expect(() => rejectBadDocumentPath('notes.txt')).toThrow(ValidationError)
  })
})

describe('resolveTargetPath', () => {
  it('resolves inside sourceRoot', () => {
    const root = join('/tmp', 'k')
    expect(resolveTargetPath(root, 'a/b.md')).toBe(join(root, 'a', 'b.md'))
  })
  it('rejects traversal that escapes sourceRoot', () => {
    expect(() => resolveTargetPath(join('/tmp', 'k'), 'a/../../b.md')).toThrow(ValidationError)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm --filter @anubis/knowledge-lite test`
Expected: FAIL ("Cannot find module './paths.js'").

- [ ] **Step 3: Write `paths.ts`**

```ts
import { resolve, join, sep } from 'node:path'
import { ValidationError } from './types.js'

/** Validate a user/agent-supplied document path. Returns the normalized
    forward-slashed relative path. Mirrors engine_fs.reject_bad_document_path. */
export function rejectBadDocumentPath(rawPath: string): string {
  if (!rawPath || !rawPath.trim()) throw new ValidationError('path must not be empty')
  const normalized = rawPath.trim().replace(/\\/g, '/')
  if (normalized.startsWith('/')) throw new ValidationError('path must be relative to the knowledge root')
  if (/^[A-Za-z]:/.test(normalized)) throw new ValidationError('path must not include a Windows drive')
  const parts = normalized.split('/').filter(p => p.length > 0)
  if (parts.some(p => p === '..')) throw new ValidationError('path must not contain ..')
  if (parts.length === 0) throw new ValidationError('path must include a file name')
  if (!parts[parts.length - 1].toLowerCase().endsWith('.md')) throw new ValidationError('path must point to a .md file')
  return parts.join('/')
}

/** Resolve a validated relative path to an absolute path guaranteed to live
    inside sourceRoot. Mirrors engine_fs.validate_target_path. */
export function resolveTargetPath(sourceRoot: string, rawPath: string): string {
  const relative = rejectBadDocumentPath(rawPath)
  const rootResolved = resolve(sourceRoot)
  const target = resolve(sourceRoot, relative)
  if (target !== rootResolved && !target.startsWith(rootResolved + sep)) {
    throw new ValidationError('path resolved outside the knowledge root')
  }
  return target
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm --filter @anubis/knowledge-lite test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge-lite/src/paths.ts packages/knowledge-lite/src/paths.test.ts
git commit -m "feat(knowledge-lite): document path validation"
```

---

## Task A9: Benchmark (parity harness)

**Files:**
- Create: `packages/knowledge-lite/src/benchmark.ts`
- Test: `packages/knowledge-lite/src/benchmark.test.ts`

Ports `compute_metrics`, `probe_query_for_chunk`, `_idf_from_chunks`, `benchmark_self_test` from `engine_search.py`. Not exposed as a runtime route — used by tests to prove the TS ranker matches Python quality.

- [ ] **Step 1: Write the failing test** (ports `BenchmarkTests`)

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeMetrics, probeQueryForChunk, benchmarkSelfTest } from './benchmark.js'
import { buildIndex } from './index-store.js'
import { DEFAULT_CONFIG, BENCHMARK_DEPTH } from './config.js'

describe('computeMetrics', () => {
  it('matches known ranks', () => {
    const m = computeMetrics([1, 2, null, 1, 5], 10)
    expect(m.count).toBe(5)
    expect(m.pAt1).toBeCloseTo(2 / 5)
    expect(m.mrr).toBeCloseTo((1 + 0.5 + 0 + 1 + 0.2) / 5)
    expect(m.recallAt3).toBeCloseTo(3 / 5)
    expect(m.misses).toBe(1)
  })
  it('treats rank beyond depth as a miss', () => {
    const m = computeMetrics([12, 3], 10)
    expect(m.misses).toBe(1)
  })
})

describe('probeQueryForChunk', () => {
  it('picks top tf*idf terms', () => {
    const chunk = { terms: new Map([['rare', 1], ['common', 5], ['alsorare', 1]]) }
    const idf = new Map([['rare', 2.0], ['common', 0.1], ['alsorare', 2.0]])
    expect(new Set(probeQueryForChunk(chunk.terms, idf, 2).split(' '))).toEqual(new Set(['rare', 'alsorare']))
  })
})

describe('benchmarkSelfTest', () => {
  let src: string; let db: string
  beforeEach(() => { const tmp = mkdtempSync(join(tmpdir(), 'kl-bench-')); src = join(tmp, 'k'); db = join(tmp, 'i.db'); mkdirSync(src, { recursive: true }) })
  afterEach(() => { rmSync(join(src, '..'), { recursive: true, force: true }) })
  const index = (files: Record<string, string>) => {
    for (const [k, v] of Object.entries(files)) { const p = join(src, k); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, v, 'utf8') }
    buildIndex(src, db, DEFAULT_CONFIG)
  }
  it('distinct docs all rank 1', () => {
    index({ 'fruit.md': '# Fruit\n\napple banana cherry mango\n', 'cars.md': '# Cars\n\nengine wheel chassis turbo\n', 'music.md': '# Music\n\nguitar melody rhythm tempo\n' })
    const { metrics } = benchmarkSelfTest(src, db, DEFAULT_CONFIG, BENCHMARK_DEPTH)
    expect(metrics.pAt1).toBe(1.0)
    expect(metrics.misses).toBe(0)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm --filter @anubis/knowledge-lite test`
Expected: FAIL ("Cannot find module './benchmark.js'").

- [ ] **Step 3: Write `benchmark.ts`**

```ts
import type { EngineConfig } from './config.js'
import { readChunksFromDb } from './index-store.js'
import { searchIndex } from './search.js'

export interface Metrics {
  count: number
  pAt1: number
  mrr: number
  recallAt3: number
  recallAt5: number
  missRate: number
  meanRank: number | null
  misses: number
}

export function computeMetrics(ranks: Array<number | null>, depth: number): Metrics {
  const n = ranks.length
  if (n === 0) return { count: 0, pAt1: 0, mrr: 0, recallAt3: 0, recallAt5: 0, missRate: 0, meanRank: null, misses: 0 }
  const found = ranks.filter((r): r is number => r !== null && r <= depth)
  const misses = n - found.length
  return {
    count: n,
    pAt1: found.filter(r => r === 1).length / n,
    mrr: found.reduce((acc, r) => acc + 1 / r, 0) / n,
    recallAt3: found.filter(r => r <= 3).length / n,
    recallAt5: found.filter(r => r <= 5).length / n,
    missRate: misses / n,
    meanRank: found.length ? found.reduce((a, b) => a + b, 0) / found.length : null,
    misses,
  }
}

export function probeQueryForChunk(terms: Map<string, number>, idf: Map<string, number>, topN: number): string {
  const scored = [...terms.entries()].sort((a, b) => {
    const sa = a[1] * (idf.get(a[0]) ?? 0)
    const sb = b[1] * (idf.get(b[0]) ?? 0)
    if (sb !== sa) return sb - sa
    return a[0].localeCompare(b[0])
  })
  return scored.slice(0, topN).map(([term]) => term).join(' ')
}

function idfFromChunks(chunks: Array<{ terms: Map<string, number> }>): Map<string, number> {
  const nChunks = chunks.length
  const docFreq = new Map<string, number>()
  for (const chunk of chunks) {
    for (const term of chunk.terms.keys()) docFreq.set(term, (docFreq.get(term) ?? 0) + 1)
  }
  const idf = new Map<string, number>()
  for (const [term, nT] of docFreq) idf.set(term, Math.log(1 + (nChunks - nT + 0.5) / (nT + 0.5)))
  return idf
}

const PROBE_TERMS = 3

export function benchmarkSelfTest(sourceRoot: string, dbPath: string, config: EngineConfig, depth: number): { metrics: Metrics } {
  const { chunks } = readChunksFromDb(dbPath)
  const idf = idfFromChunks(chunks)
  const searchConfig: EngineConfig = { ...config, searchResultLimit: depth }
  const ranks: Array<number | null> = []
  const sorted = [...chunks].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath) || a.chunkIndex - b.chunkIndex)
  for (const chunk of sorted) {
    const probe = probeQueryForChunk(chunk.terms, idf, PROBE_TERMS)
    if (!probe) continue
    const results = searchIndex(sourceRoot, dbPath, probe, searchConfig)
    let rank: number | null = null
    results.forEach((r, position) => {
      if (rank === null && r.source === chunk.sourcePath && r.startLine === chunk.startLine) rank = position + 1
    })
    ranks.push(rank)
  }
  return { metrics: computeMetrics(ranks, depth) }
}
```

Note: in `searchIndex`, results' `startLine` is rewritten to the *excerpt* start (with `searchExcerptLinesBefore`). For self-test rank matching to compare against the chunk's stored `startLine`, set `searchExcerptLinesBefore: 0` in the self-test config OR match on `source` only when a chunk is the sole one in its file. To keep parity with Python (which matched on `start_line` of the raw result before excerpt expansion), **adjust `searchIndex` to expose the pre-excerpt `startLine`**: keep `startLine`/`endLine` as the chunk's own lines and add separate `excerptStartLine`/`excerptEndLine` fields. Update `SearchResult` in `types.ts` and `renderSearchResult` accordingly in this task.

- [ ] **Step 3b: Adjust `SearchResult` to separate chunk lines from excerpt lines**

In `types.ts`, change `SearchResult` to:

```ts
export interface SearchResult {
  source: string
  startLine: number        // chunk start (stable, used for ranking/identity)
  endLine: number          // chunk end
  excerptStartLine: number // expanded excerpt window start
  excerptEndLine: number   // expanded excerpt window end
  heading: string | null
  rawScore: number
  coverage: number
  score: number
  excerpt: string
}
```

In `search.ts`, in the final loop, set `excerptStartLine`/`excerptEndLine` from `excerptForResult` and **stop overwriting** `startLine`/`endLine`:

```ts
  for (const r of trimmed) {
    r.score = topRaw ? r.rawScore / topRaw : 0
    const [start, end, excerpt] = excerptForResult(sourceRoot, r, config)
    r.excerptStartLine = start
    r.excerptEndLine = end
    r.excerpt = excerpt
  }
```

Initialize `excerptStartLine`/`excerptEndLine` to `0` where the result object is first pushed. In `renderSearchResult`, print `Lines: ${result.excerptStartLine}-${result.excerptEndLine}`. Update the Task A7 `search.test.ts` "Low confidence" assertion (unaffected) and any test referencing `startLine` to use the chunk line (still correct).

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm --filter @anubis/knowledge-lite test`
Expected: PASS (self-test P@1 = 1.0 for distinct docs).

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge-lite/src/benchmark.ts packages/knowledge-lite/src/benchmark.test.ts packages/knowledge-lite/src/types.ts packages/knowledge-lite/src/search.ts
git commit -m "feat(knowledge-lite): benchmark parity harness; split chunk vs excerpt lines"
```

---

## Task A10: Public API (`createEngine`)

**Files:**
- Modify: `packages/knowledge-lite/src/index.ts` (replace the stub)
- Test: `packages/knowledge-lite/src/index.test.ts`

Provides the programmatic surface the backend consumes: `ingest`, `search` (lazy-refresh-on-stale), `save`/`update`/`delete`, `stats`, `listDocuments`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEngine } from './index.js'
import { ValidationError } from './types.js'

let sourceRoot: string; let dbPath: string
beforeEach(() => { const tmp = mkdtempSync(join(tmpdir(), 'kl-api-')); sourceRoot = join(tmp, 'knowledge'); dbPath = join(tmp, 'db', 'index.db'); mkdirSync(sourceRoot, { recursive: true }) })
afterEach(() => { rmSync(join(sourceRoot, '..'), { recursive: true, force: true }) })

describe('createEngine', () => {
  it('save writes markdown under sourceRoot and indexes it; search finds it lazily', () => {
    const engine = createEngine({ sourceRoot, dbPath })
    engine.save({ path: 'brand/voice.md', content: '# Brand Voice\n\nwarm confident concise tone\n' })
    expect(existsSync(join(sourceRoot, 'brand', 'voice.md'))).toBe(true)
    const r = engine.search({ query: 'confident tone' })
    expect(r.results[0].source).toBe('brand/voice.md')
    expect(r.results[0].excerpt).toContain('warm confident')
  })

  it('save rejects overwrite without force; update requires existing; delete removes + reindexes', () => {
    const engine = createEngine({ sourceRoot, dbPath })
    engine.save({ path: 'a.md', content: '# A\n\nalpha\n' })
    expect(() => engine.save({ path: 'a.md', content: '# A2\n\nbeta\n' })).toThrow(ValidationError)
    engine.update({ path: 'a.md', content: '# A2\n\nbeta gamma\n' })
    expect(readFileSync(join(sourceRoot, 'a.md'), 'utf8')).toContain('beta gamma')
    engine.delete({ path: 'a.md' })
    expect(existsSync(join(sourceRoot, 'a.md'))).toBe(false)
    expect(engine.search({ query: 'beta' }).results).toEqual([])
  })

  it('stats and listDocuments report the corpus', () => {
    const engine = createEngine({ sourceRoot, dbPath })
    engine.save({ path: 'a.md', content: '# A\n\nalpha beta\n' })
    const stats = engine.stats()
    expect(stats.documentCount).toBe(1)
    expect(stats.chunkCount).toBeGreaterThanOrEqual(1)
    expect(engine.listDocuments().items[0].path).toBe('a.md')
  })
})
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm --filter @anubis/knowledge-lite test`
Expected: FAIL (no `createEngine` export).

- [ ] **Step 3: Replace `src/index.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type { EngineConfig } from './config.js'
import { DEFAULT_CONFIG } from './config.js'
import type { SearchResult } from './types.js'
import { ValidationError, FileSystemError } from './types.js'
import { buildIndex, indexIsFresh } from './index-store.js'
import { searchIndex, renderSearchResult } from './search.js'
import { resolveTargetPath } from './paths.js'

export type { EngineConfig } from './config.js'
export type { SearchResult, DocumentRow, Chunk } from './types.js'
export { ValidationError, IndexStoreError, FileSystemError } from './types.js'

export interface EngineOptions {
  /** Directory holding the markdown corpus (the workspace `knowledge/` dir). */
  sourceRoot: string
  /** Path to the per-project sqlite index file. */
  dbPath: string
  config?: Partial<EngineConfig>
}

export interface KnowledgeEngine {
  ingest(opts?: { full?: boolean }): { documents: number; chunks: number }
  search(opts: { query: string; limit?: number }): { query: string; results: SearchResult[]; lowConfidence: boolean; text: string }
  save(opts: { path: string; content: string; force?: boolean }): { path: string }
  update(opts: { path: string; content: string }): { path: string }
  delete(opts: { path: string }): { path: string }
  stats(): { documentCount: number; chunkCount: number; lastIndexedAt: string | null }
  listDocuments(): { items: Array<{ path: string; title: string; chunkCount: number; updatedAt: string }> }
}

export function createEngine(options: EngineOptions): KnowledgeEngine {
  const { sourceRoot, dbPath } = options
  const config: EngineConfig = { ...DEFAULT_CONFIG, ...(options.config ?? {}) }

  const ensureFresh = (): void => {
    if (!indexIsFresh(sourceRoot, dbPath)) buildIndex(sourceRoot, dbPath, config)
  }

  const writeDoc = (rawPath: string, content: string, mode: 'save' | 'update'): { path: string } => {
    const target = resolveTargetPath(sourceRoot, rawPath)
    if (mode === 'update' && !existsSync(target)) throw new ValidationError('target does not exist')
    mkdirSync(dirname(target), { recursive: true })
    try {
      writeFileSync(target, content, 'utf8')
    } catch (err) {
      throw new FileSystemError(`could not write ${rawPath}: ${String(err)}`)
    }
    buildIndex(sourceRoot, dbPath, config)
    return { path: rawPath }
  }

  return {
    ingest(opts) {
      mkdirSync(sourceRoot, { recursive: true })
      return buildIndex(sourceRoot, dbPath, config, opts?.full ?? false)
    },

    search(opts) {
      const query = opts.query.trim()
      if (!query) throw new ValidationError('query must not be empty')
      mkdirSync(sourceRoot, { recursive: true })
      ensureFresh()
      const limit = opts.limit ?? config.searchResultLimit
      const results = searchIndex(sourceRoot, dbPath, query, { ...config, searchResultLimit: limit })
      const lowConfidence = results.length > 0 && (results[0].coverage < 0.5 || results[0].rawScore < 1.0)
      return { query, results, lowConfidence, text: renderSearchResult(query, results) }
    },

    save(opts) {
      const target = resolveTargetPath(sourceRoot, opts.path)
      if (existsSync(target) && !opts.force) throw new ValidationError('target exists; pass force to overwrite')
      return writeDoc(opts.path, opts.content, 'save')
    },

    update(opts) {
      return writeDoc(opts.path, opts.content, 'update')
    },

    delete(opts) {
      const target = resolveTargetPath(sourceRoot, opts.path)
      if (!existsSync(target)) throw new ValidationError('target does not exist')
      try {
        rmSync(target, { force: true })
      } catch (err) {
        throw new FileSystemError(`could not delete ${opts.path}: ${String(err)}`)
      }
      buildIndex(sourceRoot, dbPath, config)
      return { path: opts.path }
    },

    stats() {
      if (!existsSync(dbPath)) return { documentCount: 0, chunkCount: 0, lastIndexedAt: null }
      const conn = new Database(dbPath, { readonly: true })
      try {
        const documentCount = (conn.prepare('SELECT COUNT(*) AS n FROM documents').get() as { n: number }).n
        const chunkCount = (conn.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n
        const last = conn.prepare('SELECT MAX(updated_at) AS t FROM documents').get() as { t: string | null }
        return { documentCount, chunkCount, lastIndexedAt: last.t }
      } finally {
        conn.close()
      }
    },

    listDocuments() {
      if (!existsSync(dbPath)) return { items: [] }
      const conn = new Database(dbPath, { readonly: true })
      try {
        const rows = conn.prepare(`
          SELECT d.path, d.title, d.updated_at, COUNT(c.id) AS chunk_count
          FROM documents d LEFT JOIN chunks c ON c.document_id = d.id
          GROUP BY d.id ORDER BY d.path
        `).all() as Array<{ path: string; title: string; updated_at: string; chunk_count: number }>
        return { items: rows.map(r => ({ path: r.path, title: r.title, chunkCount: r.chunk_count, updatedAt: r.updated_at })) }
      } finally {
        conn.close()
      }
    },
  }
}
```

- [ ] **Step 4: Run, verify it passes, then build**

Run: `pnpm --filter @anubis/knowledge-lite test`
Expected: PASS.
Then: `pnpm --filter @anubis/knowledge-lite build`
Expected: clean build with `dist/index.d.ts` present.

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge-lite/src/index.ts packages/knowledge-lite/src/index.test.ts
git commit -m "feat(knowledge-lite): public createEngine API"
```

---

## Task A11: Benchmark parity fixture

**Files:**
- Create: `packages/knowledge-lite/src/__fixtures__/knowledge/` (copy of `C:\Projects\anubis-lite\examples\knowledge\*.md`)
- Test: `packages/knowledge-lite/src/parity.test.ts`

- [ ] **Step 1: Copy the example corpus as a fixture**

Run (bash):
```bash
mkdir -p packages/knowledge-lite/src/__fixtures__/knowledge
cp /c/Projects/anubis-lite/examples/knowledge/*.md packages/knowledge-lite/src/__fixtures__/knowledge/
```

- [ ] **Step 2: Write the parity test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIndex } from './index-store.js'
import { benchmarkSelfTest } from './benchmark.js'
import { DEFAULT_CONFIG, BENCHMARK_DEPTH } from './config.js'

const fixtures = join(fileURLToPath(new URL('.', import.meta.url)), '__fixtures__', 'knowledge')

let sourceRoot: string; let dbPath: string
beforeEach(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'kl-parity-'))
  sourceRoot = join(tmp, 'knowledge'); dbPath = join(tmp, 'index.db')
  cpSync(fixtures, sourceRoot, { recursive: true })
})
afterEach(() => { rmSync(join(sourceRoot, '..'), { recursive: true, force: true }) })

describe('parity self-test over the example corpus', () => {
  it('meets the Python-baseline retrieval quality', () => {
    buildIndex(sourceRoot, dbPath, DEFAULT_CONFIG)
    const { metrics } = benchmarkSelfTest(sourceRoot, dbPath, DEFAULT_CONFIG, BENCHMARK_DEPTH)
    // Baseline from the Python tool's self-test on the same corpus.
    expect(metrics.pAt1).toBeGreaterThanOrEqual(0.8)
    expect(metrics.mrr).toBeGreaterThanOrEqual(0.85)
  })
})
```

Note: before relying on the thresholds, run the Python tool once to capture the real baseline:
`cd /c/Projects/anubis-lite && py scripts/engine.py ingest && py scripts/engine.py benchmark` (with `examples/knowledge` copied into `.anubis/anubis-lite/documents/knowledge/`), read `P@1`/`MRR` from `output/benchmark-report.md`, and set the `toBeGreaterThanOrEqual` thresholds to those values minus a small epsilon (e.g. 0.02). If the TS metrics fall below, treat it as a port bug and debug, do not lower the threshold.

- [ ] **Step 3: Run, verify it passes**

Run: `pnpm --filter @anubis/knowledge-lite test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/knowledge-lite/src/__fixtures__ packages/knowledge-lite/src/parity.test.ts
git commit -m "test(knowledge-lite): benchmark parity over example corpus"
```

---

# Phase B — Backend integration

## Task B1: Rewrite the backend knowledge-base wrapper + routes

**Files:**
- Modify: root `package.json` (add `"@anubis/knowledge-lite": "workspace:*"` to dependencies — see Task D1 for the root third-party check)
- Modify: `packages/backend/package.json` (add `"@anubis/knowledge-lite": "workspace:*"`)
- Rewrite: `packages/backend/src/knowledge-base.ts`
- Verify: `packages/backend/src/app.ts:76` still mounts `app.route('/knowledge-base', knowledgeBaseRoutes)` (no change needed)

- [ ] **Step 1: Add the dependency**

In `packages/backend/package.json`, add to `dependencies`:
```json
"@anubis/knowledge-lite": "workspace:*"
```
Run: `pnpm install`

- [ ] **Step 2: Rewrite `packages/backend/src/knowledge-base.ts`**

Replace the entire file with:

```ts
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import { createEngine, type KnowledgeEngine } from '@anubis/knowledge-lite'
import { getDataDir, getStack } from './services.js'

/* -----------------------------------------------------------
   Knowledge Base — in-process @anubis/knowledge-lite engine.

   Source of truth: <workspacePath>/knowledge/**.md
   Index (disposable): <dataDir>/knowledge-lite/<projectId>/index.db

   Agent-driven: the agent calls these routes on demand (see the
   anubis-core skill). Nothing is pre-injected.
   ----------------------------------------------------------- */

const KNOWLEDGE_SUBDIR = 'knowledge'

function knowledgeRoot(projectId: string): string {
  const workspace = getStack().projectWorkspaces.resolve(projectId)
  return join(workspace, KNOWLEDGE_SUBDIR)
}

function indexDbPath(projectId: string): string {
  return join(getDataDir(), 'knowledge-lite', projectId, 'index.db')
}

function engineFor(projectId: string): KnowledgeEngine {
  const sourceRoot = knowledgeRoot(projectId)
  mkdirSync(sourceRoot, { recursive: true })
  return createEngine({ sourceRoot, dbPath: indexDbPath(projectId) })
}

/* Serialize every engine invocation across the backend process: better-sqlite3
   writes the per-project index, and a concurrent rebuild would race on the temp
   file + rename. Cheap chain-of-promises; engine calls return in milliseconds. */
let engineQueue: Promise<unknown> = Promise.resolve()
function withEngineLock<T>(fn: () => T): Promise<T> {
  const next = engineQueue.then(fn, fn)
  engineQueue = next.catch(() => undefined)
  return next as Promise<T>
}

/** Delete a project's index dir. Safe if it never existed. */
export function deleteKnowledgeBaseForProject(projectId: string): void {
  const dir = join(getDataDir(), 'knowledge-lite', projectId)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

/* -----------------------------------------------------------
   HTTP routes
   ----------------------------------------------------------- */

const SearchBody = z.object({
  projectId: z.string().min(1),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
}).strict()

const IngestBody = z.object({
  projectId: z.string().min(1),
  full: z.boolean().optional(),
}).strict()

const SaveBody = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1),
  content: z.string(),
  force: z.boolean().optional(),
}).strict()

const UpdateBody = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1),
  content: z.string(),
}).strict()

const DeleteBody = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1),
}).strict()

const ProjectQuery = z.object({ projectId: z.string().min(1) })

export const knowledgeBaseRoutes = new Hono()

knowledgeBaseRoutes.post('/search', async (c) => {
  const body = SearchBody.parse(await c.req.json())
  const out = await withEngineLock(() => engineFor(body.projectId).search({ query: body.query, limit: body.limit }))
  return c.json({ ok: true, query: out.query, results: out.results, lowConfidence: out.lowConfidence })
})

knowledgeBaseRoutes.post('/ingest', async (c) => {
  const body = IngestBody.parse(await c.req.json())
  const out = await withEngineLock(() => engineFor(body.projectId).ingest({ full: body.full }))
  return c.json({ ok: true, documents: out.documents, chunks: out.chunks })
})

knowledgeBaseRoutes.post('/save', async (c) => {
  const body = SaveBody.parse(await c.req.json())
  const out = await withEngineLock(() => engineFor(body.projectId).save({ path: body.path, content: body.content, force: body.force }))
  return c.json({ ok: true, path: out.path })
})

knowledgeBaseRoutes.post('/update', async (c) => {
  const body = UpdateBody.parse(await c.req.json())
  const out = await withEngineLock(() => engineFor(body.projectId).update({ path: body.path, content: body.content }))
  return c.json({ ok: true, path: out.path })
})

knowledgeBaseRoutes.post('/delete', async (c) => {
  const body = DeleteBody.parse(await c.req.json())
  const out = await withEngineLock(() => engineFor(body.projectId).delete({ path: body.path }))
  return c.json({ ok: true, path: out.path })
})

knowledgeBaseRoutes.get('/stats', async (c) => {
  const { projectId } = ProjectQuery.parse(Object.fromEntries(new URL(c.req.url).searchParams))
  const out = await withEngineLock(() => engineFor(projectId).stats())
  return c.json({ ok: true, ...out })
})

knowledgeBaseRoutes.get('/documents', async (c) => {
  const { projectId } = ProjectQuery.parse(Object.fromEntries(new URL(c.req.url).searchParams))
  const out = await withEngineLock(() => engineFor(projectId).listDocuments())
  return c.json({ ok: true, items: out.items })
})
```

Note: confirm `getDataDir` is exported from `services.ts` (it is used by the old file). Confirm `getStack().projectWorkspaces.resolve(projectId)` is the same accessor the old file used (`getProjectWorkdir`). The engine's `ValidationError` etc. are plain `Error` subclasses; the backend's `app.ts` error normalizer returns 500 for non-Zod errors. If you want `ValidationError` → HTTP 400, add a mapping in `app.ts` (optional; note it in Task C-review).

- [ ] **Step 3: Map ValidationError to 400 (optional but recommended)**

In `packages/backend/src/app.ts`, find the error handler that converts `ZodError` → 400. Add, before the generic 500 branch:

```ts
  if (err instanceof Error && err.name === 'ValidationError') {
    return c.json({ ok: false, error: err.message }, 400)
  }
```

- [ ] **Step 4: Build the chain and typecheck**

Run: `pnpm --filter @anubis/knowledge-lite build && pnpm --filter @anubis/backend build`
Expected: clean build. Fix any type mismatches (e.g. `getDataDir` import).

- [ ] **Step 5: Commit**

```bash
git add package.json packages/backend/package.json packages/backend/src/knowledge-base.ts packages/backend/src/app.ts pnpm-lock.yaml
git commit -m "feat(backend): host knowledge-lite engine over /knowledge-base routes"
```

---

## Task B2: Wire project-delete cleanup

**Files:**
- Modify: `packages/backend/src/projects.ts` (around line 5 import and line 74 cleanup call)

- [ ] **Step 1: Update the import and call site**

In `packages/backend/src/projects.ts`, replace:
```ts
import { deleteKnowledgeBaseForWorkdir } from './knowledge-base.js'
```
with:
```ts
import { deleteKnowledgeBaseForProject } from './knowledge-base.js'
```

Find the project-deletion handler (near line 70-75) that calls `deleteKnowledgeBaseForWorkdir(...)`. Replace the call with `deleteKnowledgeBaseForProject(<projectId>)`, passing the project's id (the variable already in scope for the deletion). Keep the surrounding `try/catch` that logs `'[projects] knowledge-base cleanup failed:'`.

- [ ] **Step 2: Build + typecheck**

Run: `pnpm --filter @anubis/backend build`
Expected: clean; no remaining references to `deleteKnowledgeBaseForWorkdir` (grep to confirm: `git grep deleteKnowledgeBaseForWorkdir` returns nothing).

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/projects.ts
git commit -m "feat(backend): clean up per-project knowledge-lite index on project delete"
```

---

## Task B3: Backend route tests

**Files:**
- Create: `packages/backend/tests/knowledge-base.test.ts` (follow the existing backend test conventions in `packages/backend/tests/`)

- [ ] **Step 1: Inspect an existing backend test** for how the app/stack is constructed with temp dirs.

Run: `ls packages/backend/tests` and open one route test to copy its harness (temp dataDir, temp workspace, building the Hono `app`, and how `projectId` → workspace is registered).

- [ ] **Step 2: Write the test** (adapt the harness to match the existing pattern; the assertions below are the contract)

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// import { makeTestApp } from './helpers' — use whatever the existing tests use

describe('knowledge-base routes', () => {
  // setup: create a temp workspace with a `knowledge/` dir, register a project
  // whose workspace points there, build the app with a temp dataDir.

  it('save then search returns a cited hit', async () => {
    // POST /knowledge-base/save { projectId, path: 'brand/voice.md', content: '# Voice\n\nwarm confident concise\n' }
    // -> 200 { ok: true }
    // POST /knowledge-base/search { projectId, query: 'confident voice' }
    // -> 200 { ok: true, results: [{ source: 'brand/voice.md', excerpt: contains 'warm confident', ... }] }
    expect(true).toBe(true) // replace with real assertions using the chosen harness
  })

  it('search on an empty corpus returns []', async () => {
    // POST /knowledge-base/search { projectId, query: 'anything' } -> { ok: true, results: [] }
    expect(true).toBe(true)
  })

  it('save without force on an existing path returns 400', async () => {
    // save once, save again without force -> 400
    expect(true).toBe(true)
  })
})
```

Note: this is the one task whose harness depends on existing backend test infrastructure not fully shown here. Replace the placeholder bodies with real requests using the same helper the neighboring tests use. The three behaviors (save→search cited hit, empty→[], duplicate save→400) are the required coverage.

- [ ] **Step 3: Run**

Run: `pnpm --filter @anubis/knowledge-lite build && pnpm vitest run packages/backend/tests/knowledge-base.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/tests/knowledge-base.test.ts
git commit -m "test(backend): knowledge-base route coverage"
```

---

# Phase C — Teardown of the old engine & injection

## Task C1: Remove the `engineBinaryPath` setting

**Files:**
- Modify: `packages/backend/src/config.ts` (remove `engineBinaryPath` from `PatchBody`)
- Modify: `packages/conversation/src/config/app-config.ts` (remove `engineBinaryPath` field + parsing, lines ~49, ~105-106)
- Modify: `packages/frontend/src/pages/settings.tsx` (remove the engine binary input + its dirty tracking, lines ~53-54, ~81, ~89, ~101, ~200-211)
- Keep: `extractorBinaryPath` everywhere (the extractor stays external)

- [ ] **Step 1: Remove from backend config schema**

In `packages/backend/src/config.ts`, delete the line `engineBinaryPath: z.string().optional(),` from `PatchBody`.

- [ ] **Step 2: Remove from app-config**

In `packages/conversation/src/config/app-config.ts`, delete the `engineBinaryPath?: string` field and the two parsing lines that read/trim/assign `engineBinaryPath`. Leave `extractorBinaryPath` intact.

- [ ] **Step 3: Remove the Settings UI control**

In `packages/frontend/src/pages/settings.tsx`, remove `engineBinaryPathDirty`, its inclusion in the `dirty` expression, the `engineBinaryPath` entries in the submit/reset objects, and the `<…>` input block under "External binaries" that selects the `anubis-engine` binary. Keep the extractor binary control. If "External binaries" now has only the extractor, keep the heading.

- [ ] **Step 4: Build + typecheck the chain**

Run: `pnpm --filter @anubis/conversation build && pnpm --filter @anubis/backend build && pnpm --filter @anubis/frontend build`
Expected: clean. Grep to confirm no dangling refs: `git grep engineBinaryPath` returns nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/config.ts packages/conversation/src/config/app-config.ts packages/frontend/src/pages/settings.tsx
git commit -m "refactor: drop engineBinaryPath setting (engine is now in-process)"
```

---

## Task C2: Remove automatic context-pack injection

**Files:**
- Modify: `packages/backend/src/services.ts` (remove the `contextPacker` provider, ~lines 35-38)
- Modify: `packages/backend/src/content-pipeline/factory.ts` (remove the `contextPack` dep, ~lines 72-77, and `CONTEXT_PACK_BUDGET`, ~line 14)
- Modify: `packages/backend/src/content-pipeline/pipeline-service.ts` (remove the `contextPack` field + the three calls at ~189/208/227 and the `briefQuery/refineQuery/reviewQuery` plumbing that fed it)
- Modify: `packages/backend/src/content-pipeline/prompts.ts` (drop the `{{context}}` placeholder + its doc comment, ~lines 13, 85)
- Modify: `packages/conversation/src/conversations/conversation-service.ts` (remove the prompt-enrichment that consumed the context-pack, ~line 287, and the `contextPackBudget` it used)
- Modify: `packages/frontend/src/pages/active-conversation.tsx` (remove `contextPackBudget` overrides/plumbing)

This is a behavior change: pipeline drafts and conversations no longer receive pre-packed context; the agent searches the KB itself.

- [ ] **Step 1: Map every reference**

Run: `git grep -n "contextPack" -- packages/` and `git grep -n "context-pack" -- packages/`
Make a checklist of each hit. Each must be removed or rewritten in the steps below.

- [ ] **Step 2: Remove the backend provider**

In `packages/backend/src/services.ts`, delete the `contextPacker: async (projectId, query, budget) => {...}` provider block. Remove any now-unused import of `contextPack`. If `contextPacker` was passed into a stack/deps object, remove that field and update the type.

- [ ] **Step 3: Remove from the content pipeline**

In `factory.ts`, delete the `contextPack` dependency wiring and `CONTEXT_PACK_BUDGET`. In `pipeline-service.ts`, delete the `contextPack` field from the deps interface and the three `const context = await this.deps.contextPack(...)` calls; remove `context` from the data passed to prompt rendering. In `prompts.ts`, delete the `{{context}}` placeholder substitution and its comment; ensure the rendered prompt no longer references `context`.

- [ ] **Step 4: Remove conversation prompt-enrichment**

In `conversation-service.ts`, remove the block (~line 287) that builds an "improved prompt" from context-pack text, plus the `contextPackBudget` value it read and any now-dead imports. The user prompt should pass through unmodified (or keep any non-context enrichment that exists independently — inspect carefully and keep unrelated logic).

- [ ] **Step 5: Remove frontend budget plumbing**

In `active-conversation.tsx`, remove `contextPackBudget` overrides, the default-budget constant, and the settings UI that adjusts it. Remove the per-message `contextPack` display block (the metadata field will no longer be set).

- [ ] **Step 6: Build the whole chain + typecheck**

Run: `pnpm --filter @anubis/knowledge-lite build && pnpm --filter @anubis/conversation build && pnpm --filter @anubis/backend build && pnpm --filter @anubis/frontend build`
Expected: clean. Re-run `git grep -n "contextPack"` — only unrelated/no matches should remain.

- [ ] **Step 7: Commit**

```bash
git add -A packages/
git commit -m "refactor: remove automatic context-pack injection (agent-driven retrieval)"
```

---

## Task C3: Repoint the frontend KB search page; remove the graph page

**Files:**
- Modify: `packages/frontend/src/api.ts` (replace KB wrappers, ~lines 1403-1470)
- Modify: `packages/frontend/src/pages/knowledge-base.tsx` (use the new search shape)
- Delete: `packages/frontend/src/pages/knowledge-graph.tsx`
- Modify: `packages/frontend/src/lib/use-kb-loader.ts` (remove graph loading)
- Modify: `packages/frontend/src/components/dashboard/data.ts` + `sidebar.tsx` + `index.tsx` + `lib/navigation.tsx` (remove the knowledge-graph nav entry/route; keep knowledge-base)

- [ ] **Step 1: Replace the KB API wrappers in `api.ts`**

Remove `getKnowledgeBaseGraph`, `getKnowledgeBaseGraphNeighborhood`, the `KnowledgeBaseGraph*` type imports, `indexKnowledgeBase`'s graph fields, and `ignore-file`. Replace `searchKnowledgeBase` with:

```ts
export interface KnowledgeBaseSearchHit {
  source: string
  startLine: number
  endLine: number
  excerptStartLine: number
  excerptEndLine: number
  heading: string | null
  score: number
  excerpt: string
}

export async function searchKnowledgeBase(input: {
  projectId: string
  query: string
  limit?: number
}): Promise<{ query: string; results: KnowledgeBaseSearchHit[]; lowConfidence: boolean }> {
  const r = await api<{ ok: true; query: string; results: KnowledgeBaseSearchHit[]; lowConfidence: boolean }>(
    '/knowledge-base/search',
    { method: 'POST', body: JSON.stringify(input) },
  )
  return { query: r.query, results: r.results, lowConfidence: r.lowConfidence }
}

export async function ingestKnowledgeBase(projectId: string, full = false): Promise<{ documents: number; chunks: number }> {
  const r = await api<{ ok: true; documents: number; chunks: number }>(
    '/knowledge-base/ingest',
    { method: 'POST', body: JSON.stringify({ projectId, full }) },
  )
  return { documents: r.documents, chunks: r.chunks }
}

export async function knowledgeBaseStats(projectId: string): Promise<{ documentCount: number; chunkCount: number; lastIndexedAt: string | null }> {
  const params = new URLSearchParams({ projectId })
  return api(`/knowledge-base/stats?${params}`)
}

export async function knowledgeBaseDocuments(projectId: string): Promise<{ items: Array<{ path: string; title: string; chunkCount: number; updatedAt: string }> }> {
  const params = new URLSearchParams({ projectId })
  const r = await api<{ ok: true; items: Array<{ path: string; title: string; chunkCount: number; updatedAt: string }> }>(`/knowledge-base/documents?${params}`)
  return { items: r.items }
}
```

Note: keep `excerptStartLine`/`excerptEndLine` only if the backend includes them. The backend route in Task B1 returns the full `SearchResult` objects from the engine, which include those fields after Task A9 — so they are present. Confirm by checking the route's JSON.

- [ ] **Step 2: Update `knowledge-base.tsx`**

Change the search handler to read `r.results` (array of hits with `source`, `excerptStartLine`-`excerptEndLine`, `score`, `excerpt`) instead of the old `hits` shape. Render `source`, the line range, and the `excerpt` in a code block; show a "Low confidence" banner when `r.lowConfidence`. Remove any graph/stats calls that referenced removed APIs (keep `knowledgeBaseStats`/`ingestKnowledgeBase` if you want a reindex button).

- [ ] **Step 3: Delete the graph page and its loader bits**

```bash
git rm packages/frontend/src/pages/knowledge-graph.tsx
```
In `use-kb-loader.ts`, remove the `graphs` state, the `getKnowledgeBaseGraph` import + call, and the `KnowledgeBaseGraph` type. If the file existed only to load graphs, delete it and remove its usages; otherwise keep the non-graph parts.

- [ ] **Step 4: Remove the nav entry/route**

In `packages/frontend/src/components/dashboard/data.ts`, remove the `knowledge-graph` sidebar item (keep `knowledge-base`). In `sidebar.tsx`, `components/dashboard/index.tsx`, and `lib/navigation.tsx`, remove the `knowledge-graph` page case/route. Confirm the `knowledge-base` page still routes.

- [ ] **Step 5: Build + typecheck**

Run: `pnpm --filter @anubis/frontend build`
Expected: clean. Grep: `git grep -n "knowledge-graph"` and `git grep -n "KnowledgeBaseGraph"` return nothing.

- [ ] **Step 6: Commit**

```bash
git add -A packages/frontend
git commit -m "refactor(frontend): repoint KB search to lite; remove graph page"
```

---

## Task C4: Rewrite the agent-facing docs

**Files:**
- Modify: `packages/ai-agent/skills/auto-inject/anubis-core/workspace.md` (rewrite the Knowledge Base section, ~lines 70-135)
- Modify: `packages/conversation/src/skills/inject.ts` (add a one-line KB recall pointer to the always-on block)
- Modify: `docs/adr/0001-engine-state-under-anubis-datadir.md` + `docs/adr/0002-knowledge-base-workdir-equals-workspace-root.md` (add a superseded note)

- [ ] **Step 1: Rewrite the KB section in `workspace.md`**

Replace the "Routes — Knowledge Base" section so it documents the lite routes and the search-then-cite workflow. Content:

```markdown
## 3. Routes — Knowledge Base

Local markdown knowledge base for the active project. Source of truth is the
project's `knowledge/` folder; the index is rebuilt automatically when files change.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/knowledge-base/search` | Search the knowledge base (cited excerpts) |
| POST | `/knowledge-base/ingest` | Rebuild the index from `knowledge/` |
| POST | `/knowledge-base/save` | Add a markdown doc under `knowledge/` |
| POST | `/knowledge-base/update` | Replace an existing markdown doc |
| POST | `/knowledge-base/delete` | Delete a markdown doc |
| GET | `/knowledge-base/stats` | Document/chunk counts |
| GET | `/knowledge-base/documents` | List indexed documents |

### Workflow — recall before answering

Before answering from project knowledge, search and cite the source path + line range:

\`\`\`bash
curl -s -X POST "$BASE/knowledge-base/search" -H 'Content-Type: application/json' \
  -d '{"projectId":"'$PID'","query":"brand voice guidelines"}'
\`\`\`

Each result has `source`, `excerptStartLine`-`excerptEndLine`, `score`, and `excerpt`.
Cite `source:excerptStartLine`. If the response has `lowConfidence: true`, the answer
may not be in the knowledge base — do not invent it. Use a double-quoted span inside
the query for an exact phrase, e.g. `"price objection"`. To capture new knowledge,
POST `/knowledge-base/save` with a `path` under `knowledge/` and markdown `content`.
```

Remove the `/context-pack`, `/graph`, `/graph/neighborhood`, and `/ignore-file` docs.

- [ ] **Step 2: Add the always-on recall pointer**

In `packages/conversation/src/skills/inject.ts`, in `buildProjectBlock`, after the backend URL line, push:

```ts
    lines.push('Knowledge base: before answering from project knowledge, POST `/knowledge-base/search` and cite `source:line`. Capture new knowledge via `/knowledge-base/save`.')
```

- [ ] **Step 3: Note the superseded ADRs**

Prepend to each of `docs/adr/0001-*.md` and `docs/adr/0002-*.md`:

```markdown
> **Superseded (2026-06-22):** the external `anubis-engine` binary was replaced by
> the in-process `@anubis/knowledge-lite` engine. See
> `docs/superpowers/specs/2026-06-22-knowledge-lite-ts-engine-design.md`. The
> sections below are retained for historical context.
```

- [ ] **Step 4: Build conversation + typecheck**

Run: `pnpm --filter @anubis/conversation build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/ai-agent/skills/auto-inject/anubis-core/workspace.md packages/conversation/src/skills/inject.ts docs/adr
git commit -m "docs: agent KB workflow + recall pointer for lite engine"
```

---

# Phase D — Build wiring & final verification

## Task D1: Build order + packaging check

**Files:**
- Modify: root `package.json` (add `@anubis/knowledge-lite` to dependencies as `workspace:*`; ensure `better-sqlite3` remains a root dep)
- Modify: any build-order script that lists packages explicitly (per `CLAUDE.md` the order is load-bearing) — e.g. `scripts/` build helpers and the `pretest` build set in root `package.json`

- [ ] **Step 1: Add to the root dependency graph**

In root `package.json` `dependencies`, add:
```json
"@anubis/knowledge-lite": "workspace:*"
```
This makes the package reachable from the root graph so electron-builder packages it (the packaging trap from `CLAUDE.md`). Confirm `better-sqlite3` is already in root `dependencies` (it is).

- [ ] **Step 2: Insert into the build order**

Wherever the explicit build order lives (search: `git grep -n "research-crawler" -- package.json scripts/`), insert `@anubis/knowledge-lite` immediately before `@anubis/backend`. Also add it to the `pretest` build chain so tests build it first.

- [ ] **Step 3: Run the third-party packaging check from CLAUDE.md**

Run the "Quick check before tagging a release" commands from `CLAUDE.md` section "Packaging traps". Confirm every third-party import reached in compiled `dist/` (now including `better-sqlite3` via knowledge-lite) appears in the root `package.json` dependencies. `better-sqlite3` is a native `.node` module already covered by the `asarUnpack` rules.

- [ ] **Step 4: Commit**

```bash
git add package.json scripts
git commit -m "build: add @anubis/knowledge-lite to build order and root deps"
```

---

## Task D2: Full verification

- [ ] **Step 1: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: PASS across every package.

- [ ] **Step 2: Build everything**

Run: `pnpm build` (or at minimum the package build chain through frontend)
Expected: clean build.

- [ ] **Step 3: Run the test suites**

Run: `pnpm --filter @anubis/knowledge-lite test`
Expected: PASS (incl. parity).
Run: `pnpm vitest run --maxWorkers=2` (per the test-suite-worker-contention note in CLAUDE memory; the default run flakes)
Expected: PASS, or only pre-existing unrelated failures. If `better-sqlite3` throws `ERR_DLOPEN_FAILED`, run `pnpm rebuild better-sqlite3` (known ABI issue) and re-run.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run the backend alone: `pnpm --filter @anubis/backend dev:server`, then:
```bash
curl -s -X POST 127.0.0.1:4317/knowledge-base/save -H 'Content-Type: application/json' -d '{"projectId":"<id>","path":"a.md","content":"# A\n\nalpha beta\n"}'
curl -s -X POST 127.0.0.1:4317/knowledge-base/search -H 'Content-Type: application/json' -d '{"projectId":"<id>","query":"alpha"}'
```
Expected: search returns a cited hit for `a.md`. (Use a real project id; the dev port may differ — see `ANUBIS_BACKEND_PORT`.)

- [ ] **Step 5: Update the graph (per CLAUDE.md)**

Run: `graphify update .`
Expected: graph refreshed (AST-only, no API cost).

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore(knowledge-lite): verification pass green"
```

---

## Spec coverage check

- Engine port (search/ingest/save/update/delete/stats/documents) → Tasks A2–A10
- Faithful BM25 + phrase + proximity + confidence → Task A7
- Benchmark parity gate → Tasks A9, A11
- Agent-driven HTTP over existing routes → Task B1
- Workspace `knowledge/` source + per-project dataDir index → Tasks B1, B2
- Retire Rust engine + `engineBinaryPath` → Task C1
- Remove automatic context-pack injection → Task C2
- Repoint KB search GUI, park graph page → Task C3
- Auto-inject skill + instruction extender updated → Task C4
- Build order + packaging → Task D1
- Verification → Task D2

## Out of scope (future)

Knowledge graph (nodes/edges + HTML viewer) and the frontend graph page; lessons scope (`learn`/`--lessons`); an optional pipeline step that auto-searches and inlines context.
