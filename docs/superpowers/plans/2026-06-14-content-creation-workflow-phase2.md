# Content Creation Workflow — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a content item's assets through a deterministic, capability-routed orchestrator and stitch them into a `draftOutput` package, advancing `human_review(approved) → generating → draft`.

**Architecture:** Additive on Phase 1. A new `content_generation_tasks` SQLite table + a `draft_output` JSON column on `content_pipeline`. A deterministic `GenerationService` derives a task list from the approved `refinedContent`, routes each task by capability to an injected generator (text = carry-forward; image = Google Flow adapter; video/audio/voiceover = `manual`), runs them as a background job with retries, and stitches the draft. Generators and repos are injected so the orchestrator is unit-testable with mocks; the Flow adapter is a thin real wrapper not exercised in CI.

**Tech Stack:** TypeScript ESM monorepo (pnpm), better-sqlite3, Hono, Zod, React 19 + Vite, vitest. Spec: `docs/superpowers/specs/2026-06-14-content-creation-workflow-phase2-design.md`. Depends on Phase 1 (already implemented on this branch).

---

## Conventions for every task

- ESM; intra-`@anubis/*` imports use explicit `.js` extensions.
- Single backend test: `pnpm vitest run <path> --maxWorkers=2`. Backend tests import `@anubis/conversation` from `dist` — run `pnpm --filter @anubis/conversation build` (and `@anubis/shared` if its types changed) before backend tests.
- Conversation-package tests import from relative `src`.
- If better-sqlite3 throws `ERR_DLOPEN_FAILED` / NODE_MODULE_VERSION, run `pnpm rebuild better-sqlite3` (ABI mismatch, not a regression).
- No new third-party deps (`flowGenerate` is already in the packaged graph). If one is added, also add it to root `package.json` dependencies.
- Commit after each task with the message in its final step.

## File Structure

**Created:**
- `packages/conversation/src/db/migrations/027_content_generation.sql`
- `packages/conversation/src/db/repositories/content-generation-tasks-repo.ts`
- `packages/conversation/tests/db/content-generation-tasks-repo.test.ts`
- `packages/backend/src/content-generation/derive-tasks.ts` + test
- `packages/backend/src/content-generation/generators.ts` (types + registry + TextGenerator + FlowImageGenerator) + test (text + registry only)
- `packages/backend/src/content-generation/stitch.ts` + test
- `packages/backend/src/content-generation/generation-service.ts` + test
- `packages/backend/src/content-generation/factory.ts`
- `packages/backend/src/content-generation/index.ts`
- `packages/backend/tests/content-generation/*.test.ts`
- `packages/frontend/src/pages/content-studio/generation-sections.tsx`

**Modified:**
- `packages/shared/src/index.ts` — generation types + `ContentPipeline.draftOutput`
- `packages/conversation/src/db/migrations/index.ts` — register migration 27
- `packages/conversation/src/db/repositories/content-pipeline-repo.ts` — `draftOutput` patch + mapping
- `packages/conversation/src/index.ts` — wire `ContentGenerationTasksRepo` onto stack
- `packages/backend/src/content-pipeline/pipeline-service.ts` — approve → status `generating` (was `human_review`)
- `packages/backend/tests/content-pipeline/pipeline-service.test.ts` — update the approve assertion
- `packages/backend/src/content-items.ts` — generation routes + approve enqueues + generation seam
- `packages/backend/tests/content-pipeline-routes.test.ts` — update approve test + add generation route tests
- `packages/frontend/src/api.ts` — generation API client functions
- `packages/frontend/src/pages/content-studio.tsx` — replace Phase-2 placeholders with real sections

---

## Task 1: Shared types

**Files:** Modify `packages/shared/src/index.ts` (after the Phase 1 `BrandContext` interface).

- [ ] **Step 1: Add generation types + draftOutput**

Append after `BrandContext`:

```ts
/* ============================================================
   Content generation (Phase 2: generating → draft)
   ============================================================ */

export type GenerationCapability = 'text' | 'image' | 'video' | 'audio' | 'voiceover'

export type GenerationTaskType =
  | 'final_caption'
  | 'final_hashtags'
  | 'text_overlay'
  | 'image'
  | 'carousel'
  | 'video'
  | 'audio'
  | 'voiceover'

export type GenerationTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'manual'

export interface GenerationOutput {
  text?: string
  assetPaths?: string[]
  meta?: Record<string, unknown>
}

export interface GenerationTask {
  id: string
  contentId: string
  projectId: string
  type: GenerationTaskType
  capability: GenerationCapability
  generator: string
  inputPrompt: string
  status: GenerationTaskStatus
  output?: GenerationOutput
  error?: string
  retryCount: number
  createdAt: number
  updatedAt: number
}

export interface DraftOutput {
  finalCaption: string
  finalHashtags: string[]
  assets: Array<{ type: GenerationTaskType; paths: string[]; meta?: Record<string, unknown> }>
  copywriting?: Copywriting
  platformNotes?: string
  sourceRef: { candidateId?: string; referenceUrl?: string; referencePostId?: string }
  generationMeta: Array<{ taskId: string; type: GenerationTaskType; generator: string; status: GenerationTaskStatus }>
  reviewHistory: { aiReview?: AiReview; humanReview?: HumanReview }
  lessonsUsed: string[]
  generationLogs: Array<{ taskId: string; type: GenerationTaskType; status: GenerationTaskStatus; error?: string }>
  stitchedAt: number
}
```

- [ ] **Step 2: Add `draftOutput` to `ContentPipeline`**

In the `ContentPipeline` interface add (after `humanReview?`):

```ts
  draftOutput?: DraftOutput
```

- [ ] **Step 3: Build + typecheck**

Run: `pnpm --filter @anubis/shared build && pnpm --filter @anubis/shared typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): content generation task and draft output types"
```

---

## Task 2: Migration 027

**Files:** Create `packages/conversation/src/db/migrations/027_content_generation.sql`; modify `migrations/index.ts`.

- [ ] **Step 1: Write the SQL**

```sql
CREATE TABLE content_generation_tasks (
  id            TEXT PRIMARY KEY,
  content_id    TEXT NOT NULL,
  project_id    TEXT NOT NULL DEFAULT 'default',
  type          TEXT NOT NULL,
  capability    TEXT NOT NULL,
  generator     TEXT NOT NULL DEFAULT '',
  input_prompt  TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled','manual')),
  output        TEXT,
  error         TEXT,
  retry_count   INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX idx_content_generation_tasks_content ON content_generation_tasks(content_id, created_at);

ALTER TABLE content_pipeline ADD COLUMN draft_output TEXT;
```

- [ ] **Step 2: Register**

In `migrations/index.ts`, after `load(26, '026_content_pipeline.sql')`:

```ts
  load(27, '027_content_generation.sql'),
```

- [ ] **Step 3: Build + verify dist SQL**

Run: `pnpm --filter @anubis/conversation build && node -e "console.log(require('fs').existsSync('packages/conversation/dist/db/migrations/027_content_generation.sql'))"`
Expected: ends with `true`.

- [ ] **Step 4: Commit**

```bash
git add packages/conversation/src/db/migrations/027_content_generation.sql packages/conversation/src/db/migrations/index.ts
git commit -m "feat(db): migration 027 content_generation_tasks and draft_output"
```

---

## Task 3: ContentGenerationTasksRepo

**Files:** Create `packages/conversation/src/db/repositories/content-generation-tasks-repo.ts`; test `packages/conversation/tests/db/content-generation-tasks-repo.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
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
})
```

- [ ] **Step 2: Run — expect FAIL** (`pnpm vitest run packages/conversation/tests/db/content-generation-tasks-repo.test.ts --maxWorkers=2`) — module not found.

- [ ] **Step 3: Implement**

```ts
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
    `).run({ ...task })
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
```

- [ ] **Step 4: Run — expect PASS** (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/db/repositories/content-generation-tasks-repo.ts packages/conversation/tests/db/content-generation-tasks-repo.test.ts
git commit -m "feat(conversation): ContentGenerationTasksRepo"
```

---

## Task 4: ContentPipelineRepo — draftOutput column

**Files:** Modify `packages/conversation/src/db/repositories/content-pipeline-repo.ts`; test `packages/conversation/tests/db/content-pipeline-draft-output.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { ContentPipelineRepo } from '../../src/db/repositories/content-pipeline-repo.js'

describe('ContentPipelineRepo draftOutput', () => {
  it('persists and reloads draftOutput JSON', () => {
    const db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    const repo = new ContentPipelineRepo(db)
    repo.patch('c1', {
      draftOutput: {
        finalCaption: 'cap', finalHashtags: ['#a'], assets: [], sourceRef: {},
        generationMeta: [], reviewHistory: {}, lessonsUsed: [], generationLogs: [], stitchedAt: 5,
      },
    })
    expect(repo.get('c1').draftOutput?.finalCaption).toBe('cap')
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`patch` rejects `draftOutput` / not stored).

- [ ] **Step 3: Implement** — in `content-pipeline-repo.ts`:

Add to the `Row` interface: `draft_output: string | null`.
Add `draftOutput` to the JSON fields type and `COLUMN_MAP`:

```ts
type JsonFields = Pick<ContentPipeline, 'rawIdea' | 'improvedBrief' | 'refinedContent' | 'aiReview' | 'humanReview' | 'draftOutput'>
```

```ts
const COLUMN_MAP: Record<keyof PipelinePatch, string> = {
  rawIdea: 'raw_idea',
  improvedBrief: 'improved_brief',
  refinedContent: 'refined_content',
  aiReview: 'ai_review',
  humanReview: 'human_review',
  draftOutput: 'draft_output',
  transcript: 'transcript',
  transcriptSource: 'transcript_source',
}
```

In `toPipeline`, add: `draftOutput: parse(row.draft_output),`.

- [ ] **Step 4: Run — expect PASS.** Then re-run the existing repo test to confirm no regression: `pnpm vitest run packages/conversation/tests/db/content-pipeline-repo.test.ts packages/conversation/tests/db/content-pipeline-draft-output.test.ts --maxWorkers=2`.

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/db/repositories/content-pipeline-repo.ts packages/conversation/tests/db/content-pipeline-draft-output.test.ts
git commit -m "feat(conversation): pipeline draftOutput column"
```

---

## Task 5: Wire ContentGenerationTasksRepo onto the stack

**Files:** Modify `packages/conversation/src/index.ts`.

- [ ] **Step 1: Import + interface + construct + export**

- Add import: `import { ContentGenerationTasksRepo } from './db/repositories/content-generation-tasks-repo.js'`
- Add to `ConversationStack`: `contentGenerationTasks: ContentGenerationTasksRepo`
- Construct near the other content repos: `const contentGenerationTasks = new ContentGenerationTasksRepo(db)`
- Add to the returned stack object alongside `contentPipeline, contentLessons, brandContext`: `contentGenerationTasks,`

- [ ] **Step 2: Build + typecheck**

Run: `pnpm --filter @anubis/conversation build && pnpm --filter @anubis/conversation typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/conversation/src/index.ts
git commit -m "feat(conversation): generation tasks repo on stack"
```

---

## Task 6: Task derivation (pure)

**Files:** Create `packages/backend/src/content-generation/derive-tasks.ts`; test `packages/backend/tests/content-generation/derive-tasks.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { deriveTasks, buildImagePrompt } from '../../src/content-generation/derive-tasks.js'
import type { RefinedContent } from '@anubis/shared'

function refined(over: Partial<RefinedContent> = {}): RefinedContent {
  return {
    caption: 'Cap', visualBrief: { concept: 'C', sceneDirection: 'S', subject: 'Subj', layout: 'L', mood: 'M', style: 'St', keyElements: ['k1'] },
    copywriting: { hook: 'h', body: 'b', cta: 'c' },
    hashtags: { primary: ['#a'], niche: ['#b'], brandSafe: ['#c'] },
    ...over,
  }
}

describe('deriveTasks', () => {
  it('image post → caption, hashtags, single image (no overlay, no manual)', () => {
    const tasks = deriveTasks(refined(), 'image')
    const byType = tasks.map((t) => t.type)
    expect(byType).toEqual(['final_caption', 'final_hashtags', 'image'])
    expect(tasks.every((t) => t.status === 'pending')).toBe(true)
  })

  it('carousel with 3 slides → 3 carousel tasks', () => {
    const r = refined({ copywriting: { hook: 'h', body: 'b', cta: 'c', carouselSlides: ['s1', 's2', 's3'] } })
    const tasks = deriveTasks(r, 'carousel')
    expect(tasks.filter((t) => t.type === 'carousel')).toHaveLength(3)
  })

  it('adds a text_overlay task when overlay text is present', () => {
    const r = refined({ visualBrief: { ...refined().visualBrief, textOverlay: 'BUY NOW' } })
    const tasks = deriveTasks(r, 'image')
    expect(tasks.some((t) => t.type === 'text_overlay' && t.inputPrompt === 'BUY NOW')).toBe(true)
  })

  it('video source → manual video task; videoScript → manual voiceover task', () => {
    const r = refined({ copywriting: { hook: 'h', body: 'b', cta: 'c', videoScript: 'read this' } })
    const tasks = deriveTasks(r, 'video')
    expect(tasks.find((t) => t.type === 'video')?.status).toBe('manual')
    expect(tasks.find((t) => t.type === 'voiceover')?.status).toBe('manual')
  })

  it('buildImagePrompt composes the visual brief', () => {
    const p = buildImagePrompt(refined().visualBrief, 'extra slide copy')
    expect(p).toContain('Subj')
    expect(p).toContain('extra slide copy')
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (module not found).

- [ ] **Step 3: Implement**

```ts
import type { GenerationCapability, GenerationTaskStatus, GenerationTaskType, RefinedContent, VisualBrief } from '@anubis/shared'

export interface TaskSpec {
  type: GenerationTaskType
  capability: GenerationCapability
  inputPrompt: string
  status: GenerationTaskStatus
}

export const TASK_CAPABILITY: Record<GenerationTaskType, GenerationCapability> = {
  final_caption: 'text',
  final_hashtags: 'text',
  text_overlay: 'text',
  image: 'image',
  carousel: 'image',
  video: 'video',
  audio: 'audio',
  voiceover: 'voiceover',
}

export function buildImagePrompt(v: VisualBrief, slideCopy?: string): string {
  const parts = [
    v.concept,
    v.sceneDirection,
    `Subject: ${v.subject}`,
    `Layout: ${v.layout}`,
    `Mood: ${v.mood}`,
    `Style: ${v.style}`,
    v.keyElements.length ? `Key elements: ${v.keyElements.join(', ')}` : '',
    v.textOverlay ? `Text overlay: ${v.textOverlay}` : '',
    slideCopy ? `Slide: ${slideCopy}` : '',
    v.negativeDirection ? `Avoid: ${v.negativeDirection}` : '',
  ]
  return parts.filter(Boolean).join('. ')
}

function spec(type: GenerationTaskType, inputPrompt: string, status: GenerationTaskStatus = 'pending'): TaskSpec {
  return { type, capability: TASK_CAPABILITY[type], inputPrompt, status }
}

export function deriveTasks(
  refined: RefinedContent,
  mediaKind: 'image' | 'video' | 'carousel' | undefined,
): TaskSpec[] {
  const tasks: TaskSpec[] = []

  // Text — carry-forward from the refined content.
  tasks.push(spec('final_caption', refined.caption))
  const hashtags = [...refined.hashtags.primary, ...refined.hashtags.niche, ...refined.hashtags.brandSafe]
  tasks.push(spec('final_hashtags', hashtags.join(' ')))

  const overlay = refined.visualBrief.textOverlay ?? refined.copywriting.textOverlay
  if (overlay) tasks.push(spec('text_overlay', overlay))

  // Visual.
  if (mediaKind === 'carousel') {
    const slides = refined.copywriting.carouselSlides?.length ? refined.copywriting.carouselSlides : ['']
    for (const slide of slides) tasks.push(spec('carousel', buildImagePrompt(refined.visualBrief, slide)))
  } else {
    tasks.push(spec('image', buildImagePrompt(refined.visualBrief)))
  }

  // Unsupported → manual.
  if (mediaKind === 'video') tasks.push(spec('video', refined.copywriting.videoScript ?? refined.visualBrief.concept, 'manual'))
  if (refined.copywriting.videoScript) tasks.push(spec('voiceover', refined.copywriting.videoScript, 'manual'))

  return tasks
}
```

- [ ] **Step 4: Run — expect PASS** (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/content-generation/derive-tasks.ts packages/backend/tests/content-generation/derive-tasks.test.ts
git commit -m "feat(backend): generation task derivation"
```

---

## Task 7: Generators + registry

**Files:** Create `packages/backend/src/content-generation/generators.ts`; test `packages/backend/tests/content-generation/generators.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { TextGenerator, GeneratorRegistry } from '../../src/content-generation/generators.js'
import type { GenerationTask } from '@anubis/shared'

const task = (over: Partial<GenerationTask> = {}): GenerationTask => ({
  id: 't1', contentId: 'c1', projectId: 'default', type: 'final_caption', capability: 'text',
  generator: '', inputPrompt: 'hello caption', status: 'pending', retryCount: 0, createdAt: 1, updatedAt: 1, ...over,
})

describe('TextGenerator', () => {
  it('carries the input prompt forward as output text', async () => {
    const out = await new TextGenerator().generate(task(), { contentId: 'c1', assetDir: '/tmp' })
    expect(out.text).toBe('hello caption')
  })
})

describe('GeneratorRegistry', () => {
  it('resolves a generator by capability, returns undefined for unmapped', () => {
    const reg = new GeneratorRegistry([new TextGenerator()])
    expect(reg.get('text')?.name).toBe('carry-forward-text')
    expect(reg.get('video')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (module not found).

- [ ] **Step 3: Implement (text generator + registry + Flow adapter)**

```ts
import type { GenerationCapability, GenerationOutput, GenerationTask } from '@anubis/shared'

export interface GenerateCtx {
  contentId: string
  assetDir: string
}

export interface Generator {
  name: string
  capability: GenerationCapability
  generate(task: GenerationTask, ctx: GenerateCtx): Promise<GenerationOutput>
}

/** Text capability: carry the refined text forward verbatim (deterministic, free). */
export class TextGenerator implements Generator {
  name = 'carry-forward-text'
  capability: GenerationCapability = 'text'
  async generate(task: GenerationTask): Promise<GenerationOutput> {
    return { text: task.inputPrompt }
  }
}

export class GeneratorRegistry {
  private readonly byCapability = new Map<GenerationCapability, Generator>()
  constructor(generators: Generator[]) {
    for (const g of generators) this.byCapability.set(g.capability, g)
  }
  get(capability: GenerationCapability): Generator | undefined {
    return this.byCapability.get(capability)
  }
}
```

- [ ] **Step 4: Run — expect PASS** (2 tests).

- [ ] **Step 5: Add the Flow image generator (no unit test — headed adapter)**

Append to `generators.ts`:

```ts
import { mkdirSync } from 'node:fs'
import {
  ensureFlowChrome, flowGenerate,
} from '@anubis/research-crawler'
import type { AppConfig } from '@anubis/shared'
import { withCrawlerProfileDefaults } from '../chrome-defaults.js'

export interface FlowImageGeneratorDeps {
  getConfig: () => AppConfig
  getDataDir: () => string
}

/** Image capability via Google Flow (headed Chrome on the `flow` profile). */
export class FlowImageGenerator implements Generator {
  name = 'google-flow'
  capability: GenerationCapability = 'image'
  constructor(private readonly deps: FlowImageGeneratorDeps) {}

  async generate(task: GenerationTask, ctx: GenerateCtx): Promise<GenerationOutput> {
    mkdirSync(ctx.assetDir, { recursive: true })
    const cfg = this.deps.getConfig()
    const chromeOrigin = await ensureFlowChrome(withCrawlerProfileDefaults(
      { chromePath: cfg.chromePath },
      'flow', cfg, this.deps.getDataDir(),
    ))
    const result = await flowGenerate({
      chromeOrigin,
      prompt: task.inputPrompt,
      downloadDir: ctx.assetDir,
      downloadFilePrefix: `${task.type}-${task.id.slice(0, 8)}`,
    })
    return { assetPaths: result.downloadedImagePaths ?? [], meta: { resultEditUrls: result.resultEditUrls } }
  }
}
```

> If `withCrawlerProfileDefaults`'s signature differs, match the call already used in `packages/backend/src/research-crawler.ts` (`withCrawlerProfileDefaults({ chromePath, ... }, 'flow', cfg, getDataDir())`). Confirm `ensureFlowChrome` and `flowGenerate` are exported from `@anubis/research-crawler` (they are used in `research-crawler.ts`).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @anubis/research-crawler build >/dev/null 2>&1; pnpm --filter @anubis/backend typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/content-generation/generators.ts packages/backend/tests/content-generation/generators.test.ts
git commit -m "feat(backend): generation generators (text carry-forward, Flow image) and registry"
```

---

## Task 8: Draft stitching (pure)

**Files:** Create `packages/backend/src/content-generation/stitch.ts`; test `packages/backend/tests/content-generation/stitch.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { stitchDraft } from '../../src/content-generation/stitch.js'
import type { ContentPipeline, GenerationTask } from '@anubis/shared'

const pipeline = {
  contentId: 'c1', autoIterationCount: 0, updatedAt: 1,
  refinedContent: {
    caption: 'refined cap', visualBrief: { concept: '', sceneDirection: '', subject: '', layout: '', mood: '', style: '', keyElements: [] },
    copywriting: { hook: 'h', body: 'b', cta: 'c' }, hashtags: { primary: ['#a'], niche: [], brandSafe: [] }, platformNotes: 'IG',
  },
  aiReview: { decision: 'approved', checklist: [] },
  humanReview: { decision: 'approved', reviewedAt: 9 },
} as unknown as ContentPipeline

const tasks: GenerationTask[] = [
  { id: 'tc', contentId: 'c1', projectId: 'default', type: 'final_caption', capability: 'text', generator: 'carry-forward-text', inputPrompt: 'final cap', status: 'completed', output: { text: 'final cap' }, retryCount: 0, createdAt: 1, updatedAt: 2 },
  { id: 'th', contentId: 'c1', projectId: 'default', type: 'final_hashtags', capability: 'text', generator: 'carry-forward-text', inputPrompt: '#a #b', status: 'completed', output: { text: '#a #b' }, retryCount: 0, createdAt: 1, updatedAt: 2 },
  { id: 'ti', contentId: 'c1', projectId: 'default', type: 'image', capability: 'image', generator: 'google-flow', inputPrompt: 'p', status: 'completed', output: { assetPaths: ['/a.png'] }, retryCount: 0, createdAt: 1, updatedAt: 2 },
]

describe('stitchDraft', () => {
  it('assembles caption, hashtags, assets, review history, logs', () => {
    const draft = stitchDraft({
      pipeline,
      tasks,
      sourceRef: { referenceUrl: 'https://x' },
      lessonsUsed: ['be punchier'],
      now: 100,
    })
    expect(draft.finalCaption).toBe('final cap')
    expect(draft.finalHashtags).toEqual(['#a', '#b'])
    expect(draft.assets[0]!.paths).toEqual(['/a.png'])
    expect(draft.reviewHistory.humanReview?.decision).toBe('approved')
    expect(draft.generationLogs).toHaveLength(3)
    expect(draft.stitchedAt).toBe(100)
  })

  it('falls back to refined caption/hashtags when text tasks are absent', () => {
    const draft = stitchDraft({ pipeline, tasks: [tasks[2]!], sourceRef: {}, lessonsUsed: [], now: 1 })
    expect(draft.finalCaption).toBe('refined cap')
    expect(draft.finalHashtags).toEqual(['#a'])
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (module not found).

- [ ] **Step 3: Implement**

```ts
import type { ContentPipeline, DraftOutput, GenerationTask } from '@anubis/shared'

export interface StitchInput {
  pipeline: ContentPipeline
  tasks: GenerationTask[]
  sourceRef: DraftOutput['sourceRef']
  lessonsUsed: string[]
  now: number
}

export function stitchDraft(input: StitchInput): DraftOutput {
  const { pipeline, tasks } = input
  const refined = pipeline.refinedContent

  const captionTask = tasks.find((t) => t.type === 'final_caption' && t.status === 'completed')
  const hashtagsTask = tasks.find((t) => t.type === 'final_hashtags' && t.status === 'completed')

  const finalCaption = captionTask?.output?.text ?? refined?.caption ?? ''
  const finalHashtags = hashtagsTask?.output?.text
    ? hashtagsTask.output.text.split(/\s+/).filter(Boolean)
    : refined
      ? [...refined.hashtags.primary, ...refined.hashtags.niche, ...refined.hashtags.brandSafe]
      : []

  const assets = tasks
    .filter((t) => (t.type === 'image' || t.type === 'carousel') && t.output?.assetPaths?.length)
    .map((t) => ({ type: t.type, paths: t.output!.assetPaths!, meta: t.output!.meta }))

  return {
    finalCaption,
    finalHashtags,
    assets,
    copywriting: refined?.copywriting,
    platformNotes: refined?.platformNotes,
    sourceRef: input.sourceRef,
    generationMeta: tasks.map((t) => ({ taskId: t.id, type: t.type, generator: t.generator, status: t.status })),
    reviewHistory: { aiReview: pipeline.aiReview, humanReview: pipeline.humanReview },
    lessonsUsed: input.lessonsUsed,
    generationLogs: tasks.map((t) => ({ taskId: t.id, type: t.type, status: t.status, error: t.error })),
    stitchedAt: input.now,
  }
}
```

- [ ] **Step 4: Run — expect PASS** (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/content-generation/stitch.ts packages/backend/tests/content-generation/stitch.test.ts
git commit -m "feat(backend): draft stitching"
```

---

## Task 9: GenerationService (orchestrator)

**Files:** Create `packages/backend/src/content-generation/generation-service.ts`; test `packages/backend/tests/content-generation/generation-service.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest'
import { GenerationService } from '../../src/content-generation/generation-service.js'
import type { GenerationTask } from '@anubis/shared'

function refinedFixture() {
  return {
    caption: 'cap', visualBrief: { concept: 'c', sceneDirection: '', subject: 's', layout: '', mood: '', style: '', keyElements: [] },
    copywriting: { hook: 'h', body: 'b', cta: 'c' }, hashtags: { primary: ['#a'], niche: [], brandSafe: [] },
  }
}

function makeDeps(over: Record<string, unknown> = {}) {
  const item = { id: 'c1', projectId: 'default', status: 'generating' }
  let pipeline: Record<string, unknown> = { contentId: 'c1', autoIterationCount: 0, refinedContent: refinedFixture(), rawIdea: { mediaKind: 'image', assetRefs: [] } }
  let tasks: GenerationTask[] = []
  const lessons: Array<Record<string, unknown>> = []
  const statuses: string[] = []
  let seq = 0
  const tasksRepo = {
    create: vi.fn((t: Record<string, unknown>) => { const x = { id: `t${++seq}`, generator: '', retryCount: 0, createdAt: seq, updatedAt: seq, ...t } as unknown as GenerationTask; tasks.push(x); return x }),
    get: vi.fn((id: string) => tasks.find((t) => t.id === id) ?? null),
    listByContent: vi.fn(() => tasks),
    update: vi.fn((id: string, patch: Record<string, unknown>) => { const i = tasks.findIndex((t) => t.id === id); tasks[i] = { ...tasks[i]!, ...patch } as GenerationTask; return tasks[i]! }),
    deleteByContent: vi.fn(() => { tasks = [] }),
  }
  return {
    tasks: () => tasks, lessons, statuses,
    deps: {
      getItem: vi.fn(() => ({ ...item })),
      setStatus: vi.fn((_id: string, s: string) => { item.status = s; statuses.push(s) }),
      pipeline: {
        get: vi.fn(() => pipeline),
        patch: vi.fn((_id: string, patch: Record<string, unknown>) => { pipeline = { ...pipeline, ...patch }; return pipeline }),
      },
      taskRepo: tasksRepo,
      lessons: { create: vi.fn((l: Record<string, unknown>) => { lessons.push(l); return { id: 'L', createdAt: 1, ...l } }) },
      registry: { get: vi.fn(() => ({ name: 'mock', capability: 'text', generate: vi.fn(async () => ({ text: 'ok' })) })) },
      assetDirFor: vi.fn(() => '/tmp/assets'),
      maxRetries: 2,
      ...over,
    },
  }
}

describe('GenerationService.enqueue', () => {
  it('derives and inserts tasks (replacing prior ones)', () => {
    const { deps, tasks } = makeDeps()
    new GenerationService(deps as never).enqueue('c1')
    expect(deps.taskRepo.deleteByContent).toHaveBeenCalledWith('c1')
    expect(tasks().map((t) => t.type)).toEqual(['final_caption', 'final_hashtags', 'image'])
  })
})

describe('GenerationService.runAll', () => {
  it('runs pending tasks, stitches draft, sets status draft', async () => {
    const { deps, statuses } = makeDeps()
    const svc = new GenerationService(deps as never)
    svc.enqueue('c1')
    // image capability resolves to a mock too
    deps.registry.get.mockReturnValue({ name: 'mock', capability: 'image', generate: vi.fn(async () => ({ assetPaths: ['/a.png'] })) })
    await svc.runAll('c1')
    expect(statuses).toContain('draft')
    expect(deps.pipeline.patch).toHaveBeenCalledWith('c1', expect.objectContaining({ draftOutput: expect.any(Object) }))
  })

  it('creates a generation_failure lesson and stays generating when a task fails', async () => {
    const { deps, lessons, statuses } = makeDeps()
    const svc = new GenerationService(deps as never)
    svc.enqueue('c1')
    deps.registry.get.mockReturnValue({ name: 'mock', capability: 'image', generate: vi.fn(async () => { throw new Error('boom') }) })
    await svc.runAll('c1')
    expect(lessons.some((l) => l.source === 'generation_failure')).toBe(true)
    expect(statuses).not.toContain('draft')
  })

  it('leaves manual tasks alone and does not block draft', async () => {
    const { deps, statuses } = makeDeps()
    // video media → adds a manual video task
    deps.pipeline.get.mockReturnValue({ contentId: 'c1', autoIterationCount: 0, refinedContent: refinedFixture(), rawIdea: { mediaKind: 'image', assetRefs: [] } })
    const svc = new GenerationService(deps as never)
    svc.enqueue('c1')
    deps.registry.get.mockReturnValue({ name: 'mock', capability: 'image', generate: vi.fn(async () => ({ assetPaths: ['/a.png'] })) })
    await svc.runAll('c1')
    expect(statuses).toContain('draft')
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (module not found).

- [ ] **Step 3: Implement**

```ts
import type {
  ContentLesson, ContentPipeline, DraftOutput, GenerationTask, LessonType,
} from '@anubis/shared'
import { deriveTasks } from './derive-tasks.js'
import type { Generator } from './generators.js'
import { stitchDraft } from './stitch.js'

export interface GenItem { id: string; projectId: string; status: string; referenceUrl?: string; referencePostId?: string; sourceCandidateId?: string }

export interface GenerationDeps {
  getItem: (id: string) => GenItem | null
  setStatus: (id: string, status: string) => void
  pipeline: {
    get: (id: string) => ContentPipeline
    patch: (id: string, patch: Record<string, unknown>) => unknown
  }
  taskRepo: {
    create: (input: { contentId: string; projectId: string; type: GenerationTask['type']; capability: GenerationTask['capability']; inputPrompt: string; status: GenerationTask['status'] }) => GenerationTask
    get: (id: string) => GenerationTask | null
    listByContent: (contentId: string) => GenerationTask[]
    update: (id: string, patch: Partial<GenerationTask>) => GenerationTask | null
    deleteByContent: (contentId: string) => void
  }
  lessons: { create: (input: Omit<ContentLesson, 'id' | 'createdAt'>) => ContentLesson }
  registry: { get: (capability: GenerationTask['capability']) => Generator | undefined }
  assetDirFor: (contentId: string) => string
  maxRetries: number
}

export interface GenerationResult {
  status: 'draft' | 'generating'
  completed: number
  failed: number
  manual: number
}

export class GenerationService {
  constructor(private readonly deps: GenerationDeps) {}

  enqueue(id: string): GenerationTask[] {
    const item = this.requireItem(id)
    const pipeline = this.deps.pipeline.get(id)
    if (!pipeline.refinedContent) throw new Error('Cannot generate before refined content exists.')
    const mediaKind = pipeline.rawIdea?.mediaKind
    const specs = deriveTasks(pipeline.refinedContent, mediaKind)
    this.deps.taskRepo.deleteByContent(id)
    return specs.map((s) => this.deps.taskRepo.create({ contentId: id, projectId: item.projectId, ...s }))
  }

  async runAll(id: string): Promise<GenerationResult> {
    this.requireItem(id)
    const pending = this.deps.taskRepo.listByContent(id).filter((t) => t.status === 'pending')
    for (const task of pending) await this.runTask(id, task)
    return this.finalize(id)
  }

  async retryTask(id: string, taskId: string): Promise<GenerationResult> {
    const task = this.deps.taskRepo.get(taskId)
    if (task && (task.status === 'failed' || task.status === 'cancelled')) {
      const reset = this.deps.taskRepo.update(taskId, { status: 'pending', error: undefined })!
      await this.runTask(id, reset)
    }
    return this.finalize(id)
  }

  cancelTask(id: string, taskId: string): GenerationResult {
    const task = this.deps.taskRepo.get(taskId)
    if (task && (task.status === 'pending' || task.status === 'running')) {
      this.deps.taskRepo.update(taskId, { status: 'cancelled' })
    }
    return this.finalize(id)
  }

  private async runTask(id: string, task: GenerationTask): Promise<void> {
    const generator = this.deps.registry.get(task.capability)
    if (!generator) {
      this.deps.taskRepo.update(task.id, { status: 'manual' })
      return
    }
    const ctx = { contentId: id, assetDir: this.deps.assetDirFor(id) }
    let lastError = ''
    for (let attempt = 0; attempt <= this.deps.maxRetries; attempt++) {
      this.deps.taskRepo.update(task.id, { status: 'running', generator: generator.name, retryCount: attempt })
      try {
        const output = await generator.generate({ ...task, generator: generator.name }, ctx)
        this.deps.taskRepo.update(task.id, { status: 'completed', output, error: undefined })
        return
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      }
    }
    this.deps.taskRepo.update(task.id, { status: 'failed', error: lastError })
    this.deps.lessons.create({
      projectId: this.requireItem(id).projectId, contentId: id, source: 'generation_failure',
      type: 'technical_generation_error' as LessonType,
      reason: `Generation failed for ${task.type}: ${lastError}`,
      whatWentWrong: lastError,
      howToImprove: `Retry ${task.type} or adjust the prompt/provider.`,
    })
  }

  private finalize(id: string): GenerationResult {
    const tasks = this.deps.taskRepo.listByContent(id)
    const auto = tasks.filter((t) => t.status !== 'manual')
    const completed = auto.filter((t) => t.status === 'completed').length
    const failed = auto.filter((t) => t.status === 'failed').length
    const manual = tasks.filter((t) => t.status === 'manual').length
    const settled = auto.every((t) => t.status === 'completed' || t.status === 'cancelled')

    if (auto.length > 0 && settled) {
      const item = this.requireItem(id)
      const pipeline = this.deps.pipeline.get(id)
      const draft: DraftOutput = stitchDraft({
        pipeline, tasks,
        sourceRef: { candidateId: item.sourceCandidateId, referenceUrl: item.referenceUrl, referencePostId: item.referencePostId },
        lessonsUsed: pipeline.improvedBrief?.referenceLessons ?? [],
        now: Date.now(),
      })
      this.deps.pipeline.patch(id, { draftOutput: draft })
      this.deps.setStatus(id, 'draft')
      return { status: 'draft', completed, failed, manual }
    }
    return { status: 'generating', completed, failed, manual }
  }

  private requireItem(id: string): GenItem {
    const item = this.deps.getItem(id)
    if (!item) throw new Error(`content item ${id} not found`)
    return item
  }
}
```

- [ ] **Step 4: Run — expect PASS** (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/content-generation/generation-service.ts packages/backend/tests/content-generation/generation-service.test.ts
git commit -m "feat(backend): generation orchestrator service"
```

---

## Task 10: Factory + barrel

**Files:** Create `packages/backend/src/content-generation/factory.ts`, `packages/backend/src/content-generation/index.ts`.

No unit test (wires tested units to the live stack; exercised by route tests in Task 11).

- [ ] **Step 1: Implement the factory**

```ts
import { join } from 'node:path'
import { getDataDir, getStack } from '../services.js'
import { GenerationService, type GenerationDeps } from './generation-service.js'
import { FlowImageGenerator, GeneratorRegistry, TextGenerator } from './generators.js'

const MAX_RETRIES = 2

export function getGenerationService(): GenerationService {
  const stack = getStack()

  const registry = new GeneratorRegistry([
    new TextGenerator(),
    new FlowImageGenerator({ getConfig: () => stack.appConfig.get(), getDataDir }),
  ])

  const deps: GenerationDeps = {
    getItem: (id) => {
      const item = stack.contentItems.findById(id)
      if (!item) return null
      return {
        id: item.id, projectId: item.projectId ?? 'default', status: item.status,
        referenceUrl: item.referenceUrl, referencePostId: item.referencePostId, sourceCandidateId: item.sourceCandidateId,
      }
    },
    setStatus: (id, status) => { stack.contentItems.update(id, { status: status as never }) },
    pipeline: stack.contentPipeline,
    taskRepo: stack.contentGenerationTasks,
    lessons: stack.contentLessons,
    registry,
    assetDirFor: (contentId) => join(getDataDir(), 'content-pipeline', contentId, 'assets'),
    maxRetries: MAX_RETRIES,
  }

  return new GenerationService(deps)
}
```

- [ ] **Step 2: Barrel**

`index.ts`:

```ts
export * from './derive-tasks.js'
export * from './generators.js'
export * from './stitch.js'
export * from './generation-service.js'
export * from './factory.js'
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @anubis/conversation build >/dev/null 2>&1 && pnpm --filter @anubis/backend typecheck`
Expected: PASS.

> The factory passes `stack.contentPipeline`, `stack.contentGenerationTasks`, `stack.contentLessons` directly as deps — their concrete methods are a superset of the deps interfaces (method bivariance), matching the Phase 1 factory pattern. If a `patch`/`update` signature mismatch surfaces, wrap with an adapter object literal.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/content-generation/factory.ts packages/backend/src/content-generation/index.ts
git commit -m "feat(backend): generation service factory"
```

---

## Task 11: Routes + approve→generating

**Files:** Modify `packages/backend/src/content-items.ts`, `packages/backend/src/content-pipeline/pipeline-service.ts`; update `packages/backend/tests/content-pipeline/pipeline-service.test.ts` and `packages/backend/tests/content-pipeline-routes.test.ts`.

- [ ] **Step 1: Update pipeline-service approve → `generating`**

In `pipeline-service.ts` `submitHumanReview`, change the approve branch:

```ts
    } else {
      this.deps.pipeline.patch(id, { humanReview: review })
      // Phase 2: approval advances into generation. The route enqueues tasks.
      this.deps.setStatus(id, 'generating')
    }
```

- [ ] **Step 2: Update the Phase 1 service test**

In `pipeline-service.test.ts`, the "approved → status human_review" test: rename + change the assertion:

```ts
  it('approved → status generating, no lesson', async () => {
    const { deps, lessons } = makeDeps()
    deps.pipeline.get.mockReturnValue({ contentId: 'c1', autoIterationCount: 0, refinedContent: { caption: 'x' } })
    deps.runAgent.mockResolvedValue(JSON.stringify({ decision: 'approved', checklist: [] }))
    const svc = new ContentPipelineService(deps as never)
    const r = await svc.runAiReview('c1')
    expect(r.decision).toBe('approved')
    expect(deps.setStatus).toHaveBeenCalledWith('c1', 'human_review')
    expect(lessons).toHaveLength(0)
  })
```

> Note: `runAiReview` approval still goes to `human_review` (unchanged). Only `submitHumanReview` approval changes to `generating`. Add a dedicated submitHumanReview-approve assertion:

```ts
  it('submitHumanReview approved → status generating', async () => {
    const { deps } = makeDeps()
    const svc = new ContentPipelineService(deps as never)
    await svc.submitHumanReview('c1', { decision: 'approved' })
    expect(deps.setStatus).toHaveBeenCalledWith('c1', 'generating')
  })
```

Run: `pnpm vitest run packages/backend/tests/content-pipeline/pipeline-service.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 3: Write failing route tests**

Add to `packages/backend/tests/content-pipeline-routes.test.ts`:

```ts
describe('generation routes', () => {
  it('GET /content-items/:id/generation returns tasks and draftOutput', async () => {
    const app = await loadApp()
    const { getStack } = await import('../src/services.js')
    const stack = getStack()
    stack.contentItems.create({ id: 'g1', projectId: 'default', referenceUrl: 'https://x/g1', title: 'T', status: 'generating', now: Date.now() })
    stack.contentGenerationTasks.create({ contentId: 'g1', projectId: 'default', type: 'image', capability: 'image', inputPrompt: 'p', status: 'pending' })
    const res = await app.request('/content-items/g1/generation')
    expect(res.status).toBe(200)
    const body = await res.json() as { tasks: unknown[]; draftOutput: unknown }
    expect(body.tasks).toHaveLength(1)
  })

  it('cancels a generation task', async () => {
    const app = await loadApp()
    const { getStack } = await import('../src/services.js')
    const stack = getStack()
    stack.contentItems.create({ id: 'g2', projectId: 'default', referenceUrl: 'https://x/g2', title: 'T', status: 'generating', now: Date.now() })
    const task = stack.contentGenerationTasks.create({ contentId: 'g2', projectId: 'default', type: 'image', capability: 'image', inputPrompt: 'p', status: 'pending' })
    const res = await app.request(`/content-items/g2/generation/tasks/${task.id}/cancel`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(stack.contentGenerationTasks.get(task.id)?.status).toBe('cancelled')
  })
})
```

Also update the Phase 1 approve route test ("human-review approves") to expect status `generating` afterward:

```ts
  it('POST /content-items/:id/human-review approves and enqueues generation', async () => {
    const app = await loadApp()
    const { getStack } = await import('../src/services.js')
    const stack = getStack()
    stack.contentItems.create({ id: 'pc3', projectId: 'default', referenceUrl: 'https://x/p3', title: 'T', status: 'human_review', now: Date.now() })
    stack.contentPipeline.patch('pc3', {
      refinedContent: {
        caption: 'c', visualBrief: { concept: '', sceneDirection: '', subject: '', layout: '', mood: '', style: '', keyElements: [] },
        copywriting: { hook: '', body: '', cta: '' }, hashtags: { primary: [], niche: [], brandSafe: [] },
      },
      rawIdea: { mediaKind: 'image', assetRefs: [] },
    })
    const res = await app.request('/content-items/pc3/human-review', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' }),
    })
    expect(res.status).toBe(200)
    expect(stack.contentItems.findById('pc3')?.status).toBe('generating')
    expect(stack.contentGenerationTasks.listByContent('pc3').length).toBeGreaterThan(0)
  })
```

> Replace the existing `pc3` approve test with this one (the old one created `pc3` with no refinedContent; this version adds it so enqueue succeeds).

- [ ] **Step 4: Run — expect FAIL** (routes missing / approve doesn't enqueue).

- [ ] **Step 5: Implement routes + approve enqueue in `content-items.ts`**

Add to the imports / seam block (next to the pipeline seam):

```ts
import { getGenerationService } from './content-generation/index.js'

let generationProvider = getGenerationService
/** Test seam: override the generation service provider with a fake. */
export function __setGenerationProviderForTests(fn: typeof getGenerationService): void { generationProvider = fn }
```

Update the human-review route's approve path (after a successful approve):

```ts
contentItemRoutes.post('/:id/human-review', async (c) => {
  const body = HumanReviewBody.parse(await c.req.json())
  try {
    const review = await pipelineProvider().submitHumanReview(c.req.param('id'), {
      decision: body.decision,
      reason: body.reason,
      type: body.type as never,
    })
    if (review.decision === 'approved') {
      generationProvider().enqueue(c.req.param('id'))
    }
    return c.json({ ok: true, review })
  } catch (err) {
    return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: err instanceof Error ? err.message : 'failed' } }, 400)
  }
})
```

Add the generation routes (before `function toSummary`):

```ts
contentItemRoutes.post('/:id/generation/start', (c) => {
  const id = c.req.param('id')
  if (!getStack().contentItems.findById(id)) return c.json({ ok: false, error: 'not_found' }, 404)
  const svc = generationProvider()
  if (getStack().contentGenerationTasks.listByContent(id).length === 0) svc.enqueue(id)
  const job = jobManager.runJob({ kind: 'content-generation', label: `Generate · ${id}` }, async () => svc.runAll(id))
  return c.json({ ok: true, jobId: job.id })
})

contentItemRoutes.get('/:id/generation', (c) => {
  const stack = getStack()
  const id = c.req.param('id')
  if (!stack.contentItems.findById(id)) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({
    ok: true,
    tasks: stack.contentGenerationTasks.listByContent(id),
    draftOutput: stack.contentPipeline.get(id).draftOutput ?? null,
  })
})

contentItemRoutes.post('/:id/generation/tasks/:taskId/retry', async (c) => {
  const result = await generationProvider().retryTask(c.req.param('id'), c.req.param('taskId'))
  return c.json({ ok: true, result })
})

contentItemRoutes.post('/:id/generation/tasks/:taskId/cancel', (c) => {
  const result = generationProvider().cancelTask(c.req.param('id'), c.req.param('taskId'))
  return c.json({ ok: true, result })
})
```

- [ ] **Step 6: Run — expect PASS**

Run: `pnpm --filter @anubis/conversation build >/dev/null 2>&1 && pnpm --filter @anubis/backend typecheck && pnpm vitest run packages/backend/tests/content-pipeline-routes.test.ts packages/backend/tests/content-pipeline/pipeline-service.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/content-items.ts packages/backend/src/content-pipeline/pipeline-service.ts packages/backend/tests/content-pipeline-routes.test.ts packages/backend/tests/content-pipeline/pipeline-service.test.ts
git commit -m "feat(backend): generation routes and approve-to-generating"
```

---

## Task 12: Frontend API client

**Files:** Modify `packages/frontend/src/api.ts`.

- [ ] **Step 1: Add types to the `@anubis/shared` import**

Add to the import block: `type DraftOutput,` and `type GenerationTask,`.

- [ ] **Step 2: Append client functions** (end of file)

```ts
/* ------------------------------------------------------------------ *
 * Content generation (generating → draft)
 * ------------------------------------------------------------------ */

export async function startGeneration(id: string): Promise<string> {
  const r = await api<{ ok: true; jobId: string }>(
    `/content-items/${encodeURIComponent(id)}/generation/start`, { method: 'POST' },
  )
  return r.jobId
}

export async function getGeneration(id: string): Promise<{ tasks: GenerationTask[]; draftOutput: DraftOutput | null }> {
  const r = await api<{ ok: true; tasks: GenerationTask[]; draftOutput: DraftOutput | null }>(
    `/content-items/${encodeURIComponent(id)}/generation`,
  )
  return { tasks: r.tasks, draftOutput: r.draftOutput }
}

export async function retryGenerationTask(id: string, taskId: string): Promise<void> {
  await api<{ ok: true }>(
    `/content-items/${encodeURIComponent(id)}/generation/tasks/${encodeURIComponent(taskId)}/retry`, { method: 'POST' },
  )
}

export async function cancelGenerationTask(id: string, taskId: string): Promise<void> {
  await api<{ ok: true }>(
    `/content-items/${encodeURIComponent(id)}/generation/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' },
  )
}
```

- [ ] **Step 3: Build shared + typecheck frontend**

Run: `pnpm --filter @anubis/shared build && pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/api.ts
git commit -m "feat(frontend): generation API client functions"
```

---

## Task 13: Frontend Generation Queue + Draft Output

**Files:** Create `packages/frontend/src/pages/content-studio/generation-sections.tsx`; modify `packages/frontend/src/pages/content-studio.tsx`.

- [ ] **Step 1: Create the generation section components**

`generation-sections.tsx`:

```tsx
import type { DraftOutput, GenerationTask } from '@anubis/shared'
import { Section } from './sections'

const STATUS_TONE: Record<GenerationTask['status'], string> = {
  pending: 'text-muted-foreground',
  running: 'text-[var(--anubis-gold)]',
  completed: 'text-[var(--anubis-success)]',
  failed: 'text-destructive',
  cancelled: 'text-muted-foreground line-through',
  manual: 'text-[#9db8d2]',
}

export function GenerationQueueSection({
  tasks, busy, onStart, onRetry, onCancel,
}: {
  tasks: GenerationTask[]
  busy: boolean
  onStart: () => void
  onRetry: (taskId: string) => void
  onCancel: (taskId: string) => void
}) {
  return (
    <Section
      title='Generation Queue'
      right={<button type='button' disabled={busy} onClick={onStart} className='inline-flex h-8 items-center rounded-md bg-[var(--anubis-gold)] px-3 text-[12px] font-semibold text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)] disabled:opacity-50'>Start generation</button>}
    >
      {tasks.length === 0 ? (
        <p className='text-muted-foreground'>No tasks yet. Approve human review to enqueue.</p>
      ) : (
        <ul className='space-y-2'>
          {tasks.map((t) => (
            <li key={t.id} className='rounded border border-border bg-background p-2'>
              <div className='flex items-center justify-between'>
                <span className='text-[12.5px] font-medium'>{t.type} <span className='text-[11px] text-muted-foreground'>· {t.capability}{t.generator ? ` · ${t.generator}` : ''}</span></span>
                <span className={`text-[11px] font-medium ${STATUS_TONE[t.status]}`}>{t.status}{t.retryCount ? ` (retry ${t.retryCount})` : ''}</span>
              </div>
              <p className='mt-1 line-clamp-2 text-[11.5px] text-muted-foreground'>{t.inputPrompt}</p>
              {t.error ? <p className='mt-1 text-[11.5px] text-destructive'>{t.error}</p> : null}
              {t.output?.assetPaths?.length ? <p className='mt-1 text-[11px] text-muted-foreground'>{t.output.assetPaths.length} asset(s)</p> : null}
              {t.output?.text ? <p className='mt-1 text-[11.5px] text-foreground/80'>{t.output.text}</p> : null}
              <div className='mt-1.5 flex gap-2'>
                {t.status === 'failed' || t.status === 'cancelled' ? (
                  <button type='button' disabled={busy} onClick={() => onRetry(t.id)} className='text-[11px] text-[var(--anubis-gold)] hover:underline disabled:opacity-50'>Retry</button>
                ) : null}
                {t.status === 'pending' || t.status === 'running' ? (
                  <button type='button' disabled={busy} onClick={() => onCancel(t.id)} className='text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-50'>Cancel</button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

export function DraftOutputSection({ draft }: { draft: DraftOutput | null }) {
  if (!draft) return <Section title='Draft Output'><p className='text-muted-foreground'>No draft yet. Run generation to assemble it.</p></Section>
  return (
    <Section title='Draft Output'>
      <p className='text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground'>Final caption</p>
      <p className='mt-0.5 whitespace-pre-wrap'>{draft.finalCaption}</p>
      <p className='mt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground'>Final hashtags</p>
      <p className='mt-0.5 text-muted-foreground'>{draft.finalHashtags.join(' ')}</p>
      {draft.assets.length ? (
        <div className='mt-2'>
          <p className='text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground'>Assets</p>
          <ul className='mt-1 space-y-0.5'>
            {draft.assets.flatMap((a) => a.paths).map((p, i) => <li key={i} className='truncate font-mono text-[11px] text-muted-foreground'>{p}</li>)}
          </ul>
        </div>
      ) : null}
      <p className='mt-2 text-[11px] text-muted-foreground'>Stitched from {draft.generationMeta.length} task(s).</p>
    </Section>
  )
}
```

- [ ] **Step 2: Wire into the page**

In `content-studio.tsx`:
- Import the new sections + API: `import { GenerationQueueSection, DraftOutputSection } from './content-studio/generation-sections'` and add `getGeneration, startGeneration, retryGenerationTask, cancelGenerationTask` to the `@/api` import.
- Add generation state: `const [gen, setGen] = useState<{ tasks: GenerationTask[]; draftOutput: DraftOutput | null }>({ tasks: [], draftOutput: null })` (import the types from `@anubis/shared`).
- In `loadPipeline(id)`, also load generation: replace its body with:

```ts
  async function loadPipeline(id: string) {
    const [p, g] = await Promise.all([getContentPipeline(id), getGeneration(id)])
    setData(p)
    setGen(g)
  }
```

- Replace the two `<PhaseTwoPlaceholder .../>` lines with:

```tsx
              <GenerationQueueSection
                tasks={gen.tasks}
                busy={busy}
                onStart={() => void withBusy('generate', async () => {
                  const jobId = await startGeneration(selected.id)
                  await pollJob(jobId)
                  await reselectAfter(selected.id)
                  setBanner('Generation finished.')
                })}
                onRetry={(taskId) => void withBusy('retry', async () => {
                  await retryGenerationTask(selected.id, taskId); await reselectAfter(selected.id)
                })}
                onCancel={(taskId) => void withBusy('cancel', async () => {
                  await cancelGenerationTask(selected.id, taskId); await reselectAfter(selected.id)
                })}
              />
              <DraftOutputSection draft={gen.draftOutput} />
```

- Update `reselectAfter` to also refresh generation:

```ts
  function reselectAfter(id: string) {
    return Promise.all([loadPipeline(id), refreshItems()]).then(() => undefined)
  }
```

(`loadPipeline` now loads generation too, so this is sufficient.)

- Remove the now-unused `PhaseTwoPlaceholder` import.

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @anubis/frontend typecheck && pnpm --filter @anubis/frontend build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/pages/content-studio/generation-sections.tsx packages/frontend/src/pages/content-studio.tsx
git commit -m "feat(frontend): generation queue and draft output sections"
```

---

## Task 14: Full verification

- [ ] **Step 1: Build load-bearing packages**

Run: `pnpm --filter @anubis/shared build && pnpm --filter @anubis/research-crawler build && pnpm --filter @anubis/conversation build && pnpm --filter @anubis/backend build`
Expected: PASS.

- [ ] **Step 2: Typecheck all**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Run new + adjacent tests**

Run: `pnpm vitest run packages/conversation/tests/db packages/backend/tests/content-generation packages/backend/tests/content-pipeline packages/backend/tests/content-pipeline-routes.test.ts packages/backend/tests/content-items.test.ts --maxWorkers=2`
Expected: PASS. (If `ERR_DLOPEN_FAILED`, run `pnpm rebuild better-sqlite3`.)

- [ ] **Step 4: Manual smoke (optional)**

Run the app, take an item to `human_review`, click **Approve** (status → generating, tasks enqueued), open the **Generation Queue**, **Start generation** (text tasks complete; image task drives Flow if a signed-in Flow project window is open; video/voiceover show `manual`), and confirm the **Draft Output** assembles and status reaches `draft`.

- [ ] **Step 5: Final commit (if fixups)**

```bash
git add -A && git commit -m "test: content generation phase 2 verification fixups"
```

---

## Self-review notes (spec coverage)

- Status `human_review(approved) → generating → draft` → Tasks 11 (approve→generating + enqueue), 9 (runAll → draft).
- `content_generation_tasks` table + statuses → Tasks 2, 3.
- `draft_output` on pipeline → Tasks 2, 4.
- Deterministic orchestrator + capability routing → Tasks 7, 9.
- Generators: text carry-forward (real), Flow image (real), video/audio/voiceover manual → Tasks 6 (derive manual), 7 (registry has no video/audio/voiceover), 9 (manual handling).
- Manual start → Task 11 (`/generation/start`), 13 (Start button).
- Retry/cancel + retry_count → Tasks 3, 9, 11, 13.
- `generation_failure` lesson on terminal failure → Task 9.
- Draft stitching (caption, hashtags, assets, copywriting, platform notes, source ref, generation meta, review history, lessons used, logs) → Task 8.
- Routes (start/get/retry/cancel) → Task 11.
- Frontend Generation Queue + Draft Output replacing placeholders → Task 13.
- Out of scope (real video/audio/voiceover, final-draft review, config UI) → not implemented by design.
