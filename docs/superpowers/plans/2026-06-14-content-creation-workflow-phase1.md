# Content Creation Workflow — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a validated Content Planner idea into an AI-reviewed, human-reviewed draft brief through an auto-running AI pipeline that pauses at human review, with a lesson system, per-project brand context, and a dedicated "Content Studio" page.

**Architecture:** Additive on the existing markdown-canonical + SQLite split. Status enum is extended; structured pipeline artifacts and lessons live in new SQLite side-tables; brand context is a new per-project markdown doc. AI steps reuse `AiAgentService.runAgent` (CLI agent) via an injected runner, prompting for strict JSON that we extract and Zod-validate. Auto-run is a background `jobManager` job. Generation (`generating → draft`) is deferred to Phase 2 and appears as disabled UI.

**Tech Stack:** TypeScript ESM monorepo (pnpm), better-sqlite3, Hono, Zod, React 19 + Vite + Tailwind v4, vitest. Spec: `docs/superpowers/specs/2026-06-14-content-creation-workflow-phase1-design.md`.

---

## Conventions for every task

- All packages are ESM; intra-`@anubis/*` imports use explicit `.js` extensions even from `.ts`.
- Tests: vitest. Run a single backend file with `pnpm vitest run <path> --maxWorkers=2`. **Backend tests import `@anubis/conversation` from `dist`** — rebuild changed packages first: `pnpm --filter @anubis/conversation build` (and `@anubis/shared` if its types changed).
- Conversation-package tests import from relative `src` (no rebuild needed for in-package tests).
- Commit after each task with the message shown in its final step.
- If you add any **third-party** runtime import reachable from the packaged backend, also add it to the **root** `package.json` `dependencies` (electron-builder packaging rule). Phase 1 introduces no new third-party deps (uses global `fetch`, existing `zod`, existing `runTranscribe`).

---

## File Structure

**Created:**
- `packages/conversation/src/db/migrations/026_content_pipeline.sql` — new tables.
- `packages/conversation/src/db/repositories/content-pipeline-repo.ts` — `ContentPipelineRepo` (artifacts).
- `packages/conversation/src/db/repositories/content-lessons-repo.ts` — `ContentLessonsRepo`.
- `packages/conversation/src/db/repositories/brand-context-repo.ts` — `BrandContextRepo` (markdown doc).
- `packages/conversation/tests/db/content-pipeline-repo.test.ts`
- `packages/conversation/tests/db/content-lessons-repo.test.ts`
- `packages/conversation/tests/db/brand-context-repo.test.ts`
- `packages/backend/src/content-pipeline/json.ts` — JSON extraction + structured runner.
- `packages/backend/src/content-pipeline/schemas.ts` — Zod schemas + prompt builders for AI steps.
- `packages/backend/src/content-pipeline/raw-extract.ts` — raw idea assembly + transcript.
- `packages/backend/src/content-pipeline/pipeline-service.ts` — step runners, lessons, transitions, loop guard, auto-run.
- `packages/backend/src/content-pipeline/index.ts` — barrel.
- `packages/backend/tests/content-pipeline/json.test.ts`
- `packages/backend/tests/content-pipeline/schemas.test.ts`
- `packages/backend/tests/content-pipeline/raw-extract.test.ts`
- `packages/backend/tests/content-pipeline/pipeline-service.test.ts`
- `packages/backend/tests/content-pipeline-routes.test.ts`
- `packages/frontend/src/pages/content-studio.tsx` — the new page.
- `packages/frontend/src/pages/content-studio/` — section components (split files).

**Modified:**
- `packages/shared/src/index.ts` — status enum + new types.
- `packages/conversation/src/documents/document-store.ts` — add `'brand'` doc type.
- `packages/conversation/src/db/repositories/content-items-repo.ts` — status enum, `sourceCandidateId`.
- `packages/conversation/src/db/migrations/index.ts` — register migration 26.
- `packages/conversation/src/index.ts` — wire new repos onto the stack.
- `packages/backend/src/content-items.ts` — new routes (`from-candidate`, `extract`, `pipeline/*`, `human-review`, `lessons`).
- `packages/backend/src/app.ts` — mount brand-context routes (if not folded into content-items).
- `packages/frontend/src/api.ts` — client functions for the new endpoints.
- `packages/frontend/src/lib/navigation.tsx` — `content-studio` route.
- `packages/frontend/src/components/dashboard/data.ts` — sidebar entry.
- `packages/frontend/src/components/dashboard/index.tsx` — route→component + breadcrumb.
- `packages/frontend/src/components/dashboard/sidebar.tsx` — section switch case.
- `packages/frontend/src/pages/planner.tsx` — extend `STATUSES`/labels/tones for the new statuses.
- `packages/frontend/src/pages/research.tsx` (or candidate list component) — "Save as idea" button.

---

## Task 1: Shared types — status enum + pipeline/lesson/brand types

**Files:**
- Modify: `packages/shared/src/index.ts:17` (the `ContentItemStatus` line) and append new interfaces near `ContentItemSummary` (~line 882).

- [ ] **Step 1: Extend the status enum**

Replace line 17:

```ts
export type ContentItemStatus =
  | 'idea'
  | 'raw_extracted'
  | 'brief'
  | 'content_refined'
  | 'ai_review'
  | 'human_review'
  | 'generating'
  | 'draft'
  | 'review'
  | 'scheduled'
  | 'published'
  | 'rejected'
```

- [ ] **Step 2: Add `sourceCandidateId` to the content item interfaces**

In `ContentItemSummary` (~line 899, after `sourceConversationId?`) and `CreateContentItemInput` add:

```ts
  sourceCandidateId?: string
```

- [ ] **Step 3: Append the new domain types**

Add at the end of the Content section (after `ContentItemListResponse`, ~line 931):

```ts
/* ============================================================
   Content pipeline (Phase 1: idea → human_review)
   ============================================================ */

export type LessonSource = 'ai_review' | 'human_review' | 'generation_failure' | 'final_draft_review'
export type LessonType =
  | 'brand_alignment'
  | 'tone_of_voice'
  | 'niche_alignment'
  | 'content_quality'
  | 'visual_quality'
  | 'copywriting_quality'
  | 'technical_generation_error'

export interface ContentLesson {
  id: string
  projectId: string
  contentId: string
  source: LessonSource
  type: LessonType
  reason: string
  whatWentWrong: string
  howToImprove: string
  relatedBrandRule?: string
  relatedToneRule?: string
  relatedNicheRule?: string
  createdAt: number
}

export interface RawIdea {
  caption?: string
  assetRefs: string[]
  sourceUrl?: string
  sourcePlatform?: string
  sourceCompetitor?: string
  mediaKind?: 'image' | 'video' | 'carousel'
  mediaMetadata?: Record<string, unknown>
  transcript?: string
}

export interface ImprovedBrief {
  coreIdea: string
  targetAudience: string
  marketFit: string
  problem: string
  mainMessage: string
  contentAngle: string
  hookDirection: string
  brandAlignmentNotes: string
  toneDirection: string
  adaptationStrategy: string
  riskNotes: string
  referenceLessons: string[]
}

export interface VisualBrief {
  concept: string
  sceneDirection: string
  subject: string
  layout: string
  mood: string
  style: string
  keyElements: string[]
  textOverlay?: string
  negativeDirection?: string
}

export interface Copywriting {
  hook: string
  body: string
  cta: string
  textOverlay?: string
  carouselSlides?: string[]
  videoScript?: string
}

export interface Hashtags {
  primary: string[]
  niche: string[]
  brandSafe: string[]
  platformNotes?: string
}

export interface RefinedContent {
  caption: string
  visualBrief: VisualBrief
  copywriting: Copywriting
  hashtags: Hashtags
  platformNotes?: string
}

export interface AiReviewChecklistItem {
  criterion: string
  pass: boolean
  note?: string
}

export interface AiReview {
  decision: 'approved' | 'rejected'
  score?: number
  checklist: AiReviewChecklistItem[]
  rejectionReason?: string
  improvementInstruction?: string
}

export interface HumanReview {
  decision: 'approved' | 'rejected'
  reason?: string
  reviewedAt: number
}

export interface ContentPipeline {
  contentId: string
  rawIdea?: RawIdea
  improvedBrief?: ImprovedBrief
  refinedContent?: RefinedContent
  aiReview?: AiReview
  humanReview?: HumanReview
  transcript?: string
  transcriptSource?: string
  autoIterationCount: number
  updatedAt: number
}

export interface BrandContext {
  projectId: string
  brandGuideline: string
  toneOfVoice: string
  targetAudience: string
  nichePositioning: string
  contentRules: string
  updatedAt: number
}
```

- [ ] **Step 4: Build shared and typecheck**

Run: `pnpm --filter @anubis/shared build && pnpm --filter @anubis/shared typecheck`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): content pipeline status enum and types"
```

---

## Task 2: Migration 026 — content_pipeline + content_lessons tables

**Files:**
- Create: `packages/conversation/src/db/migrations/026_content_pipeline.sql`
- Modify: `packages/conversation/src/db/migrations/index.ts`

- [ ] **Step 1: Write the migration SQL**

Create `026_content_pipeline.sql`:

```sql
CREATE TABLE content_pipeline (
  content_id            TEXT PRIMARY KEY,
  raw_idea              TEXT,
  improved_brief        TEXT,
  refined_content       TEXT,
  ai_review             TEXT,
  human_review          TEXT,
  transcript            TEXT,
  transcript_source     TEXT,
  auto_iteration_count  INTEGER NOT NULL DEFAULT 0,
  updated_at            INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE content_lessons (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL DEFAULT 'default',
  content_id          TEXT NOT NULL,
  source              TEXT NOT NULL CHECK (source IN ('ai_review','human_review','generation_failure','final_draft_review')),
  type                TEXT NOT NULL CHECK (type IN ('brand_alignment','tone_of_voice','niche_alignment','content_quality','visual_quality','copywriting_quality','technical_generation_error')),
  reason              TEXT NOT NULL,
  what_went_wrong     TEXT NOT NULL,
  how_to_improve      TEXT NOT NULL,
  related_brand_rule  TEXT,
  related_tone_rule   TEXT,
  related_niche_rule  TEXT,
  created_at          INTEGER NOT NULL
);

CREATE INDEX idx_content_lessons_project ON content_lessons(project_id, created_at DESC);
CREATE INDEX idx_content_lessons_content ON content_lessons(content_id, created_at DESC);
```

- [ ] **Step 2: Register the migration**

In `packages/conversation/src/db/migrations/index.ts`, add to the `MIGRATIONS` array after `load(25, '025_markdown_canonical.sql')`:

```ts
  load(26, '026_content_pipeline.sql'),
```

- [ ] **Step 3: Verify migration loads (build the package)**

Run: `pnpm --filter @anubis/conversation build`
Expected: PASS. (The `.sql` is read via `readFileSync` relative to the compiled dir; confirm it is copied to `dist`. If `dist/db/migrations/*.sql` is absent, check the package build script — existing migrations already rely on this, so it should be wired.)

- [ ] **Step 4: Confirm SQL files ship to dist**

Run: `node -e "const fs=require('fs');console.log(fs.existsSync('packages/conversation/dist/db/migrations/026_content_pipeline.sql'))"`
Expected: `true`.

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/db/migrations/026_content_pipeline.sql packages/conversation/src/db/migrations/index.ts
git commit -m "feat(db): migration 026 content_pipeline and content_lessons"
```

---

## Task 3: ContentPipelineRepo

**Files:**
- Create: `packages/conversation/src/db/repositories/content-pipeline-repo.ts`
- Test: `packages/conversation/tests/db/content-pipeline-repo.test.ts`

- [ ] **Step 1: Write the failing test**

Look at an existing in-package DB test (e.g. `packages/conversation/tests/db/markdown-canonical-schema.test.ts`) for the helper that opens an in-memory/temp DB and runs migrations. Reuse that helper (`openTestDb()` or equivalent). Create the test:

```ts
import { describe, expect, it } from 'vitest'
import { openMigratedDb } from './helpers.js' // use the existing helper in this folder
import { ContentPipelineRepo } from '../../src/db/repositories/content-pipeline-repo.js'

describe('ContentPipelineRepo', () => {
  it('returns a default empty pipeline for an unknown id', () => {
    const db = openMigratedDb()
    const repo = new ContentPipelineRepo(db)
    const p = repo.get('c1')
    expect(p).toEqual({ contentId: 'c1', autoIterationCount: 0, updatedAt: 0 })
  })

  it('persists and round-trips structured artifacts as JSON', () => {
    const db = openMigratedDb()
    const repo = new ContentPipelineRepo(db)
    repo.patch('c1', {
      rawIdea: { caption: 'hi', assetRefs: ['a.jpg'] },
      improvedBrief: {
        coreIdea: 'x', targetAudience: 'y', marketFit: 'm', problem: 'p',
        mainMessage: 'msg', contentAngle: 'angle', hookDirection: 'hook',
        brandAlignmentNotes: 'bn', toneDirection: 'td', adaptationStrategy: 'as',
        riskNotes: 'rn', referenceLessons: ['l1'],
      },
    })
    const p = repo.get('c1')
    expect(p.rawIdea?.caption).toBe('hi')
    expect(p.improvedBrief?.referenceLessons).toEqual(['l1'])
    expect(p.updatedAt).toBeGreaterThan(0)
  })

  it('increments and resets the auto-iteration counter', () => {
    const db = openMigratedDb()
    const repo = new ContentPipelineRepo(db)
    expect(repo.incrementIteration('c1')).toBe(1)
    expect(repo.incrementIteration('c1')).toBe(2)
    repo.resetIteration('c1')
    expect(repo.get('c1').autoIterationCount).toBe(0)
  })
})
```

> If `tests/db/helpers.ts` does not exist, create a minimal one: open `better-sqlite3` `':memory:'`, then `import { migrate } from '../../src/db/migrate.js'` and `import { MIGRATIONS } from '../../src/db/migrations/index.js'` and apply them (copy the call pattern used in the existing canonical-schema test).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/conversation/tests/db/content-pipeline-repo.test.ts --maxWorkers=2`
Expected: FAIL ("Cannot find module content-pipeline-repo").

- [ ] **Step 3: Implement the repo**

Create `content-pipeline-repo.ts`:

```ts
import type { ContentPipeline } from '@anubis/shared'
import type { Db } from '../client.js'

interface Row {
  content_id: string
  raw_idea: string | null
  improved_brief: string | null
  refined_content: string | null
  ai_review: string | null
  human_review: string | null
  transcript: string | null
  transcript_source: string | null
  auto_iteration_count: number
  updated_at: number
}

type JsonFields = Pick<ContentPipeline, 'rawIdea' | 'improvedBrief' | 'refinedContent' | 'aiReview' | 'humanReview'>
type ScalarFields = Pick<ContentPipeline, 'transcript' | 'transcriptSource'>
export type PipelinePatch = Partial<JsonFields & ScalarFields>

function parse<T>(value: string | null): T | undefined {
  if (value == null) return undefined
  try { return JSON.parse(value) as T } catch { return undefined }
}

function toPipeline(row: Row): ContentPipeline {
  return {
    contentId: row.content_id,
    rawIdea: parse(row.raw_idea),
    improvedBrief: parse(row.improved_brief),
    refinedContent: parse(row.refined_content),
    aiReview: parse(row.ai_review),
    humanReview: parse(row.human_review),
    transcript: row.transcript ?? undefined,
    transcriptSource: row.transcript_source ?? undefined,
    autoIterationCount: row.auto_iteration_count,
    updatedAt: row.updated_at,
  }
}

export class ContentPipelineRepo {
  constructor(private readonly db: Db) {}

  get(contentId: string): ContentPipeline {
    const row = this.db.prepare('SELECT * FROM content_pipeline WHERE content_id = ?').get(contentId) as Row | undefined
    if (!row) return { contentId, autoIterationCount: 0, updatedAt: 0 }
    return toPipeline(row)
  }

  patch(contentId: string, patch: PipelinePatch): ContentPipeline {
    const now = Date.now()
    this.ensure(contentId)
    const sets: string[] = []
    const params: Record<string, unknown> = { id: contentId, updated_at: now }
    const map: Record<keyof PipelinePatch, string> = {
      rawIdea: 'raw_idea', improvedBrief: 'improved_brief', refinedContent: 'refined_content',
      aiReview: 'ai_review', humanReview: 'human_review',
      transcript: 'transcript', transcriptSource: 'transcript_source',
    }
    for (const [key, column] of Object.entries(map) as Array<[keyof PipelinePatch, string]>) {
      if (!(key in patch)) continue
      const value = patch[key]
      sets.push(`${column} = @${column}`)
      const isJson = key !== 'transcript' && key !== 'transcriptSource'
      params[column] = value == null ? null : isJson ? JSON.stringify(value) : value
    }
    sets.push('updated_at = @updated_at')
    this.db.prepare(`UPDATE content_pipeline SET ${sets.join(', ')} WHERE content_id = @id`).run(params)
    return this.get(contentId)
  }

  incrementIteration(contentId: string): number {
    this.ensure(contentId)
    this.db.prepare('UPDATE content_pipeline SET auto_iteration_count = auto_iteration_count + 1, updated_at = ? WHERE content_id = ?')
      .run(Date.now(), contentId)
    return this.get(contentId).autoIterationCount
  }

  resetIteration(contentId: string): void {
    this.ensure(contentId)
    this.db.prepare('UPDATE content_pipeline SET auto_iteration_count = 0, updated_at = ? WHERE content_id = ?')
      .run(Date.now(), contentId)
  }

  delete(contentId: string): void {
    this.db.prepare('DELETE FROM content_pipeline WHERE content_id = ?').run(contentId)
  }

  private ensure(contentId: string): void {
    this.db.prepare('INSERT OR IGNORE INTO content_pipeline (content_id) VALUES (?)').run(contentId)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/conversation/tests/db/content-pipeline-repo.test.ts --maxWorkers=2`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/db/repositories/content-pipeline-repo.ts packages/conversation/tests/db/content-pipeline-repo.test.ts packages/conversation/tests/db/helpers.ts
git commit -m "feat(conversation): ContentPipelineRepo"
```

---

## Task 4: ContentLessonsRepo

**Files:**
- Create: `packages/conversation/src/db/repositories/content-lessons-repo.ts`
- Test: `packages/conversation/tests/db/content-lessons-repo.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { openMigratedDb } from './helpers.js'
import { ContentLessonsRepo } from '../../src/db/repositories/content-lessons-repo.js'

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/conversation/tests/db/content-lessons-repo.test.ts --maxWorkers=2`
Expected: FAIL ("Cannot find module content-lessons-repo").

- [ ] **Step 3: Implement the repo**

```ts
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
    const rows = this.db.prepare('SELECT * FROM content_lessons WHERE content_id = ? ORDER BY created_at DESC').all(contentId) as Row[]
    return rows.map(toLesson)
  }

  listByProject(projectId: string, limit = 200): ContentLesson[] {
    const rows = this.db.prepare('SELECT * FROM content_lessons WHERE project_id = ? ORDER BY created_at DESC LIMIT ?').all(projectId, limit) as Row[]
    return rows.map(toLesson)
  }

  listForInjection(q: InjectionQuery): ContentLesson[] {
    const limit = q.limit ?? 8
    if (q.types?.length) {
      const placeholders = q.types.map(() => '?').join(',')
      const rows = this.db.prepare(
        `SELECT * FROM content_lessons WHERE project_id = ? AND type IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`,
      ).all(q.projectId, ...q.types, limit) as Row[]
      return rows.map(toLesson)
    }
    return this.listByProject(q.projectId, limit)
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/conversation/tests/db/content-lessons-repo.test.ts --maxWorkers=2`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/conversation/src/db/repositories/content-lessons-repo.ts packages/conversation/tests/db/content-lessons-repo.test.ts
git commit -m "feat(conversation): ContentLessonsRepo"
```

---

## Task 5: Brand context — new doc type + BrandContextRepo

**Files:**
- Modify: `packages/conversation/src/documents/document-store.ts:16` and `:35`
- Create: `packages/conversation/src/db/repositories/brand-context-repo.ts`
- Test: `packages/conversation/tests/db/brand-context-repo.test.ts`

- [ ] **Step 1: Add the `'brand'` document type**

In `document-store.ts` line 16:

```ts
export type CanonicalDocumentType = 'task' | 'competitor' | 'content' | 'research' | 'brand'
```

And the `CommonFrontmatter` `type` enum (line 35):

```ts
  type: z.enum(['task', 'competitor', 'content', 'research', 'brand']),
```

- [ ] **Step 2: Write the failing test**

Brand context is a markdown doc, so the test needs the `MarkdownDocumentStore` over a temp workspace. Reuse the pattern from `packages/conversation/tests/research/research-service.test.ts` or `markdown-canonical-schema.test.ts` for building a `MarkdownDocumentStore` against a temp `ProjectWorkspaces`. Create the test:

```ts
import { describe, expect, it } from 'vitest'
import { makeDocumentStore } from './helpers.js' // add a helper that returns a MarkdownDocumentStore over a temp dir + 'default' project
import { BrandContextRepo } from '../../src/db/repositories/brand-context-repo.js'

describe('BrandContextRepo', () => {
  it('returns empty fields for a project with no doc yet', () => {
    const repo = new BrandContextRepo(makeDocumentStore())
    const bc = repo.get('default')
    expect(bc.brandGuideline).toBe('')
    expect(bc.toneOfVoice).toBe('')
  })

  it('saves and reloads the structured fields', () => {
    const repo = new BrandContextRepo(makeDocumentStore())
    repo.save('default', {
      brandGuideline: 'Be bold', toneOfVoice: 'Playful', targetAudience: 'Founders',
      nichePositioning: 'AI tooling', contentRules: 'No emojis in headlines',
    })
    const bc = repo.get('default')
    expect(bc.brandGuideline).toBe('Be bold')
    expect(bc.contentRules).toBe('No emojis in headlines')
  })
})
```

> Add `makeDocumentStore()` to `tests/db/helpers.ts`: construct a temp dir (e.g. `mkdtempSync(join(tmpdir(),'anubis-'))`), build `ProjectWorkspaces` rooted there with a `'default'` project (copy the construction used in an existing markdown test), and return `new MarkdownDocumentStore(workspaces)`.

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run packages/conversation/tests/db/brand-context-repo.test.ts --maxWorkers=2`
Expected: FAIL ("Cannot find module brand-context-repo").

- [ ] **Step 4: Implement the repo**

```ts
import type { BrandContext } from '@anubis/shared'
import { readSection, writeSections } from '../../documents/markdown-sections.js'
import type { MarkdownDocumentStore } from '../../documents/document-store.js'

const ROOT = 'knowledge/brand'
const DOC_ID_PREFIX = 'brand-context'

const SECTIONS = {
  brandGuideline: 'Brand Guideline',
  toneOfVoice: 'Tone of Voice',
  targetAudience: 'Target Audience',
  nichePositioning: 'Niche Positioning',
  contentRules: 'Content Rules',
} as const

export type BrandContextFields = Pick<
  BrandContext,
  'brandGuideline' | 'toneOfVoice' | 'targetAudience' | 'nichePositioning' | 'contentRules'
>

export class BrandContextRepo {
  constructor(private readonly documents: MarkdownDocumentStore) {}

  private docId(projectId: string): string {
    return `${DOC_ID_PREFIX}-${projectId}`
  }

  get(projectId: string): BrandContext {
    const doc = this.documents.find('brand', ROOT, this.docId(projectId))
    const body = doc?.body ?? ''
    return {
      projectId,
      brandGuideline: readSection(body, SECTIONS.brandGuideline) ?? '',
      toneOfVoice: readSection(body, SECTIONS.toneOfVoice) ?? '',
      targetAudience: readSection(body, SECTIONS.targetAudience) ?? '',
      nichePositioning: readSection(body, SECTIONS.nichePositioning) ?? '',
      contentRules: readSection(body, SECTIONS.contentRules) ?? '',
      updatedAt: doc ? Date.parse(String(doc.data.updated_at)) : 0,
    }
  }

  save(projectId: string, fields: BrandContextFields): BrandContext {
    const existing = this.documents.find('brand', ROOT, this.docId(projectId))
    const body = writeSections(existing?.body ?? '', {
      [SECTIONS.brandGuideline]: fields.brandGuideline,
      [SECTIONS.toneOfVoice]: fields.toneOfVoice,
      [SECTIONS.targetAudience]: fields.targetAudience,
      [SECTIONS.nichePositioning]: fields.nichePositioning,
      [SECTIONS.contentRules]: fields.contentRules,
    })
    this.documents.write({
      type: 'brand',
      projectId,
      root: ROOT,
      id: this.docId(projectId),
      title: `Brand Context — ${projectId}`,
      existing,
      data: {},
      body,
    })
    return this.get(projectId)
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run packages/conversation/tests/db/brand-context-repo.test.ts --maxWorkers=2`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/conversation/src/documents/document-store.ts packages/conversation/src/db/repositories/brand-context-repo.ts packages/conversation/tests/db/brand-context-repo.test.ts packages/conversation/tests/db/helpers.ts
git commit -m "feat(conversation): brand doc type and BrandContextRepo"
```

---

## Task 6: Extend ContentItemsRepo + wire new repos onto the stack

**Files:**
- Modify: `packages/conversation/src/db/repositories/content-items-repo.ts`
- Modify: `packages/conversation/src/index.ts`
- Test: `packages/conversation/tests/db/content-items-source-candidate.test.ts` (new)

- [ ] **Step 1: Update the status enum + add `sourceCandidateId` in the repo**

In `content-items-repo.ts`:
- In `ContentData` (line 57) replace the status enum with the 12-value list:

```ts
  status: z.enum(['idea', 'raw_extracted', 'brief', 'content_refined', 'ai_review', 'human_review', 'generating', 'draft', 'review', 'scheduled', 'published', 'rejected']),
```

- Add `source_candidate_id: z.string().optional().nullable(),` to `ContentData`.
- Add `sourceCandidateId?: string` to the `ContentItem` interface and `CreateContentItemInput`.
- In `create()`, set `sourceCandidateId: input.sourceCandidateId`.
- In `write()` `data`, add `source_candidate_id: item.sourceCandidateId ?? null`.
- In `toItem()`, add `sourceCandidateId: data.source_candidate_id ?? undefined`.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { makeContentItemsRepo } from './helpers.js' // helper returning ContentItemsRepo over temp store+db
import type { ContentItemStatus } from '@anubis/shared'

describe('ContentItemsRepo new statuses + sourceCandidateId', () => {
  it('round-trips a raw_extracted status and a source candidate id', () => {
    const repo = makeContentItemsRepo()
    const created = repo.create({
      id: 'c1', projectId: 'default', referenceUrl: 'https://x', title: 'T',
      status: 'raw_extracted' as ContentItemStatus, sourceCandidateId: 'cand-9', now: Date.now(),
    })
    expect(created.status).toBe('raw_extracted')
    expect(created.sourceCandidateId).toBe('cand-9')
    const reloaded = repo.findByIdOrThrow('c1')
    expect(reloaded.status).toBe('raw_extracted')
    expect(reloaded.sourceCandidateId).toBe('cand-9')
  })
})
```

> Add `makeContentItemsRepo()` to `tests/db/helpers.ts`: `new ContentItemsRepo(openMigratedDb(), makeDocumentStore())` sharing one temp workspace+db (construct both over the same temp project root so the runtime table and the doc store agree on `'default'`). Follow the construction already used by any existing content-items test if present.

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run packages/conversation/tests/db/content-items-source-candidate.test.ts --maxWorkers=2`
Expected: FAIL (status enum rejects `raw_extracted` / `sourceCandidateId` undefined).

- [ ] **Step 4: Make it pass**

Apply the Step-1 edits if not already complete. Re-run:
Run: `pnpm vitest run packages/conversation/tests/db/content-items-source-candidate.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Wire the new repos onto the stack**

In `packages/conversation/src/index.ts`:
- Import the three new repos.
- Add to `ConversationStack` interface: `contentPipeline: ContentPipelineRepo`, `contentLessons: ContentLessonsRepo`, `brandContext: BrandContextRepo`.
- In `createConversationService`, construct them: `new ContentPipelineRepo(db)`, `new ContentLessonsRepo(db)`, `new BrandContextRepo(documents)` and include them in the returned stack object.
- Re-export the repo types from the package index (add `export type { ContentPipeline, ContentLesson, BrandContext } from '@anubis/shared'` is unnecessary; instead `export { ContentPipelineRepo } …` if other packages need the classes — backend uses the stack instances, so only ensure the stack carries them).

- [ ] **Step 6: Build + typecheck the package**

Run: `pnpm --filter @anubis/conversation build && pnpm --filter @anubis/conversation typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/conversation/src/db/repositories/content-items-repo.ts packages/conversation/src/index.ts packages/conversation/tests/db/content-items-source-candidate.test.ts packages/conversation/tests/db/helpers.ts
git commit -m "feat(conversation): content item new statuses, sourceCandidateId, pipeline repos on stack"
```

---

## Task 7: JSON extraction + structured runner

**Files:**
- Create: `packages/backend/src/content-pipeline/json.ts`
- Test: `packages/backend/tests/content-pipeline/json.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { extractJson, runStructured } from '../../src/content-pipeline/json.js'

const Schema = z.object({ a: z.number(), b: z.string() })

describe('extractJson', () => {
  it('parses a fenced ```json block', () => {
    const text = 'prose\n```json\n{"a":1,"b":"x"}\n```\nmore'
    expect(extractJson(text, Schema)).toEqual({ a: 1, b: 'x' })
  })
  it('parses the first balanced object when unfenced', () => {
    expect(extractJson('Here: {"a":2,"b":"y"} done', Schema)).toEqual({ a: 2, b: 'y' })
  })
  it('throws on invalid shape', () => {
    expect(() => extractJson('{"a":"no"}', Schema)).toThrow()
  })
})

describe('runStructured', () => {
  it('returns parsed output on first try', async () => {
    const runner = vi.fn().mockResolvedValue('```json\n{"a":1,"b":"x"}\n```')
    const out = await runStructured(runner, { prompt: 'p', schema: Schema })
    expect(out).toEqual({ a: 1, b: 'x' })
    expect(runner).toHaveBeenCalledTimes(1)
  })
  it('retries once on parse failure then succeeds', async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce('garbage no json')
      .mockResolvedValueOnce('{"a":1,"b":"x"}')
    const out = await runStructured(runner, { prompt: 'p', schema: Schema })
    expect(out).toEqual({ a: 1, b: 'x' })
    expect(runner).toHaveBeenCalledTimes(2)
  })
  it('throws after the retry also fails', async () => {
    const runner = vi.fn().mockResolvedValue('still not json')
    await expect(runStructured(runner, { prompt: 'p', schema: Schema })).rejects.toThrow()
    expect(runner).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/backend/tests/content-pipeline/json.test.ts --maxWorkers=2`
Expected: FAIL ("Cannot find module json").

- [ ] **Step 3: Implement**

```ts
import type { z } from 'zod'

/** A minimal agent runner: takes a prompt, returns the agent's final text. */
export type StructuredRunner = (prompt: string) => Promise<string>

/** Find the first balanced {...} object substring, ignoring braces in strings. */
function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export function extractJson<T>(text: string, schema: z.ZodType<T>): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1]!.trim() : (firstJsonObject(text) ?? text.trim())
  const obj = firstJsonObject(candidate) ?? candidate
  return schema.parse(JSON.parse(obj))
}

export interface RunStructuredOpts<T> {
  prompt: string
  schema: z.ZodType<T>
  /** Extra instruction appended on the retry attempt. */
  retryHint?: string
}

export async function runStructured<T>(
  runner: StructuredRunner,
  opts: RunStructuredOpts<T>,
): Promise<T> {
  try {
    return extractJson(await runner(opts.prompt), opts.schema)
  } catch {
    const hint = opts.retryHint
      ?? 'Your previous reply was not valid JSON. Reply with ONLY a single JSON object, no prose, no code fence.'
    const retryPrompt = `${opts.prompt}\n\n${hint}`
    return extractJson(await runner(retryPrompt), opts.schema)
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/backend/tests/content-pipeline/json.test.ts --maxWorkers=2`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/content-pipeline/json.ts packages/backend/tests/content-pipeline/json.test.ts
git commit -m "feat(backend): structured JSON extraction for pipeline AI steps"
```

---

## Task 8: AI step Zod schemas + prompt builders

**Files:**
- Create: `packages/backend/src/content-pipeline/schemas.ts`
- Test: `packages/backend/tests/content-pipeline/schemas.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import {
  ImprovedBriefSchema, RefinedContentSchema, AiReviewSchema,
  buildBriefPrompt, buildRefinePrompt, buildReviewPrompt,
} from '../../src/content-pipeline/schemas.js'

describe('pipeline schemas', () => {
  it('validates a well-formed brief', () => {
    const ok = ImprovedBriefSchema.safeParse({
      coreIdea: 'a', targetAudience: 'b', marketFit: 'c', problem: 'd', mainMessage: 'e',
      contentAngle: 'f', hookDirection: 'g', brandAlignmentNotes: 'h', toneDirection: 'i',
      adaptationStrategy: 'j', riskNotes: 'k', referenceLessons: [],
    })
    expect(ok.success).toBe(true)
  })
  it('rejects an ai review with a bad decision', () => {
    const bad = AiReviewSchema.safeParse({ decision: 'maybe', checklist: [] })
    expect(bad.success).toBe(false)
  })
})

describe('prompt builders', () => {
  it('brief prompt embeds raw idea, brand context, and lessons', () => {
    const p = buildBriefPrompt({
      rawIdea: { caption: 'CAP', assetRefs: [] },
      brand: { brandGuideline: 'BG', toneOfVoice: 'TOV', targetAudience: 'TA', nichePositioning: 'NP', contentRules: 'CR' },
      lessons: [{ type: 'tone_of_voice', howToImprove: 'be punchier' }],
      kbHits: [],
    })
    expect(p).toContain('CAP')
    expect(p).toContain('BG')
    expect(p).toContain('be punchier')
    expect(p.toLowerCase()).toContain('json')
  })
  it('review prompt asks for approved/rejected', () => {
    const p = buildReviewPrompt({ refined: { caption: 'x' } as never, brand: undefined, niche: 'NP' })
    expect(p).toContain('approved')
    expect(p).toContain('rejected')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/backend/tests/content-pipeline/schemas.test.ts --maxWorkers=2`
Expected: FAIL ("Cannot find module schemas").

- [ ] **Step 3: Implement the schemas + prompt builders**

```ts
import { z } from 'zod'
import type { BrandContext, ContentLesson, ImprovedBrief, RawIdea, RefinedContent } from '@anubis/shared'

export const ImprovedBriefSchema = z.object({
  coreIdea: z.string(),
  targetAudience: z.string(),
  marketFit: z.string(),
  problem: z.string(),
  mainMessage: z.string(),
  contentAngle: z.string(),
  hookDirection: z.string(),
  brandAlignmentNotes: z.string(),
  toneDirection: z.string(),
  adaptationStrategy: z.string(),
  riskNotes: z.string(),
  referenceLessons: z.array(z.string()).default([]),
}) satisfies z.ZodType<ImprovedBrief>

export const RefinedContentSchema = z.object({
  caption: z.string(),
  visualBrief: z.object({
    concept: z.string(),
    sceneDirection: z.string(),
    subject: z.string(),
    layout: z.string(),
    mood: z.string(),
    style: z.string(),
    keyElements: z.array(z.string()).default([]),
    textOverlay: z.string().optional(),
    negativeDirection: z.string().optional(),
  }),
  copywriting: z.object({
    hook: z.string(),
    body: z.string(),
    cta: z.string(),
    textOverlay: z.string().optional(),
    carouselSlides: z.array(z.string()).optional(),
    videoScript: z.string().optional(),
  }),
  hashtags: z.object({
    primary: z.array(z.string()).default([]),
    niche: z.array(z.string()).default([]),
    brandSafe: z.array(z.string()).default([]),
    platformNotes: z.string().optional(),
  }),
  platformNotes: z.string().optional(),
}) satisfies z.ZodType<RefinedContent>

export const AiReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  score: z.number().optional(),
  checklist: z.array(z.object({
    criterion: z.string(),
    pass: z.boolean(),
    note: z.string().optional(),
  })).default([]),
  rejectionReason: z.string().optional(),
  improvementInstruction: z.string().optional(),
})

function brandBlock(brand: BrandContext | Partial<BrandContext> | undefined): string {
  if (!brand) return '(no brand context provided)'
  return [
    `Brand guideline: ${brand.brandGuideline ?? ''}`,
    `Tone of voice: ${brand.toneOfVoice ?? ''}`,
    `Target audience: ${brand.targetAudience ?? ''}`,
    `Niche positioning: ${brand.nichePositioning ?? ''}`,
    `Content rules: ${brand.contentRules ?? ''}`,
  ].join('\n')
}

function lessonsBlock(lessons: Array<Pick<ContentLesson, 'type' | 'howToImprove'>>): string {
  if (!lessons.length) return '(no prior lessons)'
  return lessons.map((l) => `- [${l.type}] ${l.howToImprove}`).join('\n')
}

const JSON_ONLY = 'Reply with ONLY a single JSON object matching the schema. No prose, no markdown fence.'

export function buildBriefPrompt(input: {
  rawIdea: RawIdea
  brand: BrandContext | Partial<BrandContext> | undefined
  lessons: Array<Pick<ContentLesson, 'type' | 'howToImprove'>>
  kbHits: string[]
}): string {
  return [
    'You are a content strategist. Analyze the source content and produce an IMPROVED BRIEF for our brand.',
    '',
    'Answer internally: what is this about; topic; market fit; audience problem; information communicated; why it performed; angle/hook; emotional trigger; content structure; what we can adapt.',
    '',
    '=== SOURCE (raw idea) ===',
    `Caption: ${input.rawIdea.caption ?? ''}`,
    input.rawIdea.transcript ? `Transcript: ${input.rawIdea.transcript}` : '',
    `Platform: ${input.rawIdea.sourcePlatform ?? ''}`,
    `Source URL: ${input.rawIdea.sourceUrl ?? ''}`,
    '',
    '=== BRAND CONTEXT ===',
    brandBlock(input.brand),
    '',
    '=== LESSONS FROM PAST MISTAKES (apply these) ===',
    lessonsBlock(input.lessons),
    '',
    input.kbHits.length ? `=== KNOWLEDGE BASE ===\n${input.kbHits.join('\n')}` : '',
    '',
    'Produce JSON with keys: coreIdea, targetAudience, marketFit, problem, mainMessage, contentAngle, hookDirection, brandAlignmentNotes, toneDirection, adaptationStrategy, riskNotes, referenceLessons (string[]).',
    JSON_ONLY,
  ].filter(Boolean).join('\n')
}

export function buildRefinePrompt(input: {
  brief: ImprovedBrief
  brand: BrandContext | Partial<BrandContext> | undefined
}): string {
  return [
    'Turn this brief into content-ready material for our brand.',
    '',
    '=== BRIEF ===',
    JSON.stringify(input.brief, null, 2),
    '',
    '=== BRAND CONTEXT ===',
    brandBlock(input.brand),
    '',
    'Produce JSON with keys:',
    'caption (string),',
    'visualBrief { concept, sceneDirection, subject, layout, mood, style, keyElements (string[]), textOverlay?, negativeDirection? },',
    'copywriting { hook, body, cta, textOverlay?, carouselSlides? (string[]), videoScript? },',
    'hashtags { primary (string[]), niche (string[]), brandSafe (string[]), platformNotes? },',
    'platformNotes?.',
    JSON_ONLY,
  ].join('\n')
}

export function buildReviewPrompt(input: {
  refined: RefinedContent
  brand: BrandContext | Partial<BrandContext> | undefined
  niche?: string
}): string {
  return [
    'Review the refined content and decide if it is good enough to continue.',
    'Validate: niche alignment, brand alignment, tone of voice, content clarity, hook strength, message quality, audience relevance, visual brief quality, copywriting quality, similarity-to-competitor risk, hallucination risk, misleading-claim risk, weak-differentiation risk.',
    '',
    '=== CONTENT ===',
    JSON.stringify(input.refined, null, 2),
    '',
    '=== BRAND CONTEXT ===',
    brandBlock(input.brand),
    input.niche ? `Niche: ${input.niche}` : '',
    '',
    'Decision MUST be exactly "approved" or "rejected".',
    'Produce JSON: { decision: "approved"|"rejected", score (0-100 number, optional), checklist: [{ criterion, pass (boolean), note? }], rejectionReason? (required if rejected), improvementInstruction? (required if rejected) }.',
    JSON_ONLY,
  ].filter(Boolean).join('\n')
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/backend/tests/content-pipeline/schemas.test.ts --maxWorkers=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/content-pipeline/schemas.ts packages/backend/tests/content-pipeline/schemas.test.ts
git commit -m "feat(backend): pipeline AI step schemas and prompt builders"
```

---

## Task 9: Raw extraction (assemble raw idea + transcript)

**Files:**
- Create: `packages/backend/src/content-pipeline/raw-extract.ts`
- Test: `packages/backend/tests/content-pipeline/raw-extract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest'
import { buildRawIdea } from '../../src/content-pipeline/raw-extract.js'
import type { CapturedPostSummary } from '@anubis/shared'

const imgPost = {
  id: 'p1', competitorId: 'k1', username: 'acme', postUrl: 'https://ig/p/1',
  caption: 'hello', mediaKind: 'image', mediaUrl: 'https://cdn/x.jpg', capturedAt: 1,
  competitorHandle: '@acme',
} as CapturedPostSummary

describe('buildRawIdea', () => {
  it('assembles fields from an image post without transcribing', async () => {
    const transcribe = vi.fn()
    const raw = await buildRawIdea({ post: imgPost, transcribeMedia: transcribe })
    expect(raw.caption).toBe('hello')
    expect(raw.sourceUrl).toBe('https://ig/p/1')
    expect(raw.mediaKind).toBe('image')
    expect(raw.transcript).toBeUndefined()
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('transcribes a video post and stores the transcript', async () => {
    const transcribe = vi.fn().mockResolvedValue('spoken words')
    const raw = await buildRawIdea({
      post: { ...imgPost, mediaKind: 'video', mediaUrl: 'https://cdn/v.mp4' },
      transcribeMedia: transcribe,
    })
    expect(transcribe).toHaveBeenCalledWith('https://cdn/v.mp4')
    expect(raw.transcript).toBe('spoken words')
  })

  it('falls back to referenceUrl when there is no post', async () => {
    const raw = await buildRawIdea({ referenceUrl: 'https://ig/p/9', transcribeMedia: vi.fn() })
    expect(raw.sourceUrl).toBe('https://ig/p/9')
    expect(raw.assetRefs).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/backend/tests/content-pipeline/raw-extract.test.ts --maxWorkers=2`
Expected: FAIL ("Cannot find module raw-extract").

- [ ] **Step 3: Implement (pure assembly + injected transcriber)**

```ts
import type { CapturedPostSummary, RawIdea } from '@anubis/shared'

/** Download `mediaUrl` and return transcript text. Injected so tests stay pure. */
export type TranscribeMedia = (mediaUrl: string) => Promise<string>

export interface BuildRawIdeaInput {
  post?: CapturedPostSummary
  referenceUrl?: string
  transcribeMedia: TranscribeMedia
}

export async function buildRawIdea(input: BuildRawIdeaInput): Promise<RawIdea> {
  const { post, referenceUrl } = input
  const assetRefs = post?.mediaUrl ? [post.mediaUrl] : []
  const raw: RawIdea = {
    caption: post?.caption,
    assetRefs,
    sourceUrl: post?.postUrl ?? referenceUrl,
    sourcePlatform: post ? 'instagram' : undefined,
    sourceCompetitor: post?.competitorHandle ?? post?.username,
    mediaKind: post?.mediaKind,
    mediaMetadata: post
      ? { likes: post.likes, comments: post.comments, postedAt: post.postedAt, carouselCount: post.carouselCount }
      : undefined,
  }

  if (post?.mediaKind === 'video' && post.mediaUrl) {
    raw.transcript = await input.transcribeMedia(post.mediaUrl)
  }
  // image / carousel: no OCR by default (Phase 1).

  return raw
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/backend/tests/content-pipeline/raw-extract.test.ts --maxWorkers=2`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the production transcriber helper (no test — thin IO wrapper)**

Append to `raw-extract.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTranscribe } from '../extractor.js'

/** Real transcriber: fetch the media to a temp file, then run whisper via the extractor CLI. */
export function makeRealTranscriber(): TranscribeMedia {
  return async (mediaUrl: string) => {
    const res = await fetch(mediaUrl)
    if (!res.ok) throw new Error(`Failed to download media (${res.status})`)
    const buf = Buffer.from(await res.arrayBuffer())
    const dir = mkdtempSync(join(tmpdir(), 'anubis-media-'))
    const ext = mediaUrl.split('?')[0]!.endsWith('.mp4') ? '.mp4' : '.mp4'
    const file = join(dir, `media${ext}`)
    writeFileSync(file, buf)
    const result = await runTranscribe(file)
    return result.text
  }
}
```

- [ ] **Step 6: Build backend + typecheck**

Run: `pnpm --filter @anubis/backend typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/content-pipeline/raw-extract.ts packages/backend/tests/content-pipeline/raw-extract.test.ts
git commit -m "feat(backend): raw idea assembly with video transcription"
```

---

## Task 10: Pipeline service — AI steps, lessons, transitions, loop guard

**Files:**
- Create: `packages/backend/src/content-pipeline/pipeline-service.ts`
- Create: `packages/backend/src/content-pipeline/index.ts`
- Test: `packages/backend/tests/content-pipeline/pipeline-service.test.ts`

This service is constructed with a small **deps** object so tests inject fakes for the repos and the agent runner. It does NOT import the stack directly.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest'
import { ContentPipelineService } from '../../src/content-pipeline/pipeline-service.js'

function makeDeps(overrides = {}) {
  const statuses: string[] = []
  const item = { id: 'c1', projectId: 'default', status: 'raw_extracted', referencePostId: undefined, referenceUrl: 'u' }
  let pipeline: any = { contentId: 'c1', autoIterationCount: 0, rawIdea: { caption: 'cap', assetRefs: [] } }
  const lessons: any[] = []
  return {
    statuses, lessons,
    deps: {
      getItem: vi.fn(() => ({ ...item })),
      setStatus: vi.fn((_id: string, s: string) => { item.status = s; statuses.push(s) }),
      pipeline: {
        get: vi.fn(() => pipeline),
        patch: vi.fn((_id, patch) => { pipeline = { ...pipeline, ...patch }; return pipeline }),
        incrementIteration: vi.fn(() => ++pipeline.autoIterationCount),
        resetIteration: vi.fn(() => { pipeline.autoIterationCount = 0 }),
      },
      lessons: { create: vi.fn((l) => { const x = { id: 'L', createdAt: 1, ...l }; lessons.push(x); return x }), listForInjection: vi.fn(() => []) },
      brand: { get: vi.fn(() => undefined) },
      kbSearch: vi.fn(async () => []),
      runAgent: vi.fn(),
      maxAutoIterations: 3,
      ...overrides,
    },
  }
}

describe('ContentPipelineService.runBreakdown', () => {
  it('produces a brief and moves to status brief', async () => {
    const { deps } = makeDeps()
    deps.runAgent.mockResolvedValue(JSON.stringify({
      coreIdea: 'a', targetAudience: 'b', marketFit: 'c', problem: 'd', mainMessage: 'e',
      contentAngle: 'f', hookDirection: 'g', brandAlignmentNotes: 'h', toneDirection: 'i',
      adaptationStrategy: 'j', riskNotes: 'k', referenceLessons: [],
    }))
    const svc = new ContentPipelineService(deps as never)
    await svc.runBreakdown('c1')
    expect(deps.pipeline.patch).toHaveBeenCalledWith('c1', expect.objectContaining({ improvedBrief: expect.any(Object) }))
    expect(deps.setStatus).toHaveBeenCalledWith('c1', 'brief')
  })
})

describe('ContentPipelineService.runAiReview', () => {
  it('approved → status human_review, no lesson', async () => {
    const { deps, lessons } = makeDeps()
    deps.pipeline.get.mockReturnValue({ contentId: 'c1', autoIterationCount: 0, refinedContent: { caption: 'x' } })
    deps.runAgent.mockResolvedValue(JSON.stringify({ decision: 'approved', checklist: [] }))
    const svc = new ContentPipelineService(deps as never)
    const r = await svc.runAiReview('c1')
    expect(r.decision).toBe('approved')
    expect(deps.setStatus).toHaveBeenCalledWith('c1', 'human_review')
    expect(lessons).toHaveLength(0)
  })

  it('rejected → creates a lesson and moves back to brief', async () => {
    const { deps, lessons } = makeDeps()
    deps.pipeline.get.mockReturnValue({ contentId: 'c1', autoIterationCount: 0, refinedContent: { caption: 'x' } })
    deps.runAgent.mockResolvedValue(JSON.stringify({
      decision: 'rejected', checklist: [], rejectionReason: 'off-brand', improvementInstruction: 'fix tone',
    }))
    const svc = new ContentPipelineService(deps as never)
    const r = await svc.runAiReview('c1')
    expect(r.decision).toBe('rejected')
    expect(lessons[0].source).toBe('ai_review')
    expect(deps.setStatus).toHaveBeenCalledWith('c1', 'brief')
  })
})

describe('ContentPipelineService.submitHumanReview', () => {
  it('reject requires a reason and creates a human lesson', async () => {
    const { deps, lessons } = makeDeps()
    const svc = new ContentPipelineService(deps as never)
    await expect(svc.submitHumanReview('c1', { decision: 'rejected' })).rejects.toThrow()
    await svc.submitHumanReview('c1', { decision: 'rejected', reason: 'weak hook', type: 'copywriting_quality' })
    expect(lessons[0].source).toBe('human_review')
    expect(deps.setStatus).toHaveBeenCalledWith('c1', 'brief')
  })
})

describe('ContentPipelineService.runAuto loop guard', () => {
  it('stops after maxAutoIterations consecutive rejections', async () => {
    const { deps } = makeDeps({ maxAutoIterations: 2 })
    deps.pipeline.get.mockReturnValue({ contentId: 'c1', autoIterationCount: 0, rawIdea: { caption: 'c', assetRefs: [] }, refinedContent: { caption: 'x' } })
    // brief, refine always succeed; review always rejects
    deps.runAgent.mockImplementation(async (prompt: string) => {
      if (prompt.includes('IMPROVED BRIEF')) return JSON.stringify(briefFixture())
      if (prompt.includes('content-ready')) return JSON.stringify(refinedFixture())
      return JSON.stringify({ decision: 'rejected', checklist: [], rejectionReason: 'no', improvementInstruction: 'x' })
    })
    const svc = new ContentPipelineService(deps as never)
    const result = await svc.runAuto('c1')
    expect(result.stoppedReason).toBe('max_iterations')
  })
})

function briefFixture() {
  return { coreIdea: 'a', targetAudience: 'b', marketFit: 'c', problem: 'd', mainMessage: 'e', contentAngle: 'f', hookDirection: 'g', brandAlignmentNotes: 'h', toneDirection: 'i', adaptationStrategy: 'j', riskNotes: 'k', referenceLessons: [] }
}
function refinedFixture() {
  return { caption: 'x', visualBrief: { concept: '', sceneDirection: '', subject: '', layout: '', mood: '', style: '', keyElements: [] }, copywriting: { hook: '', body: '', cta: '' }, hashtags: { primary: [], niche: [], brandSafe: [] } }
}
```

> The prompt substrings checked above (`'IMPROVED BRIEF'`, `'content-ready'`) must appear in the respective prompt builders. The brief prompt from Task 8 contains "IMPROVED BRIEF"; the refine prompt contains "content-ready material". Keep those phrases.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/backend/tests/content-pipeline/pipeline-service.test.ts --maxWorkers=2`
Expected: FAIL ("Cannot find module pipeline-service").

- [ ] **Step 3: Implement the service**

```ts
import type {
  AiReview, BrandContext, ContentLesson, HumanReview, ImprovedBrief, LessonType, RefinedContent,
} from '@anubis/shared'
import { runStructured, type StructuredRunner } from './json.js'
import {
  AiReviewSchema, ImprovedBriefSchema, RefinedContentSchema,
  buildBriefPrompt, buildRefinePrompt, buildReviewPrompt,
} from './schemas.js'

export interface PipelineItem {
  id: string
  projectId: string
  status: string
  referencePostId?: string
  referenceUrl?: string
}

export interface PipelineDeps {
  getItem: (id: string) => PipelineItem | null
  setStatus: (id: string, status: string) => void
  pipeline: {
    get: (id: string) => { contentId: string; autoIterationCount: number; rawIdea?: unknown; improvedBrief?: ImprovedBrief; refinedContent?: RefinedContent }
    patch: (id: string, patch: Record<string, unknown>) => unknown
    incrementIteration: (id: string) => number
    resetIteration: (id: string) => void
  }
  lessons: {
    create: (input: Omit<ContentLesson, 'id' | 'createdAt'>) => ContentLesson
    listForInjection: (q: { projectId: string; types?: LessonType[]; limit?: number }) => ContentLesson[]
  }
  brand: { get: (projectId: string) => BrandContext | undefined }
  kbSearch: (projectId: string, query: string) => Promise<string[]>
  runAgent: (input: { prompt: string; cwd: string; projectId: string; step: string }) => Promise<string>
  maxAutoIterations: number
}

export interface AutoResult {
  finalStatus: string
  stoppedReason: 'human_review' | 'max_iterations'
  iterations: number
}

export class ContentPipelineService {
  constructor(private readonly deps: PipelineDeps) {}

  private runner(item: PipelineItem, step: string): StructuredRunner {
    return (prompt: string) => this.deps.runAgent({ prompt, cwd: `content-pipeline/${item.id}`, projectId: item.projectId, step })
  }

  async runBreakdown(id: string): Promise<ImprovedBrief> {
    const item = this.requireItem(id)
    const p = this.deps.pipeline.get(id)
    const rawIdea = (p.rawIdea ?? { assetRefs: [] }) as never
    const brand = this.deps.brand.get(item.projectId)
    const lessons = this.deps.lessons.listForInjection({ projectId: item.projectId, limit: 8 })
    const kbHits = await this.deps.kbSearch(item.projectId, brand?.nichePositioning ?? '')
    const brief = await runStructured(this.runner(item, 'brief'), {
      prompt: buildBriefPrompt({ rawIdea, brand, lessons, kbHits }),
      schema: ImprovedBriefSchema,
    })
    this.deps.pipeline.patch(id, { improvedBrief: brief })
    this.deps.setStatus(id, 'brief')
    return brief
  }

  async runRefine(id: string): Promise<RefinedContent> {
    const item = this.requireItem(id)
    const p = this.deps.pipeline.get(id)
    if (!p.improvedBrief) throw new Error('Cannot refine before a brief exists.')
    const brand = this.deps.brand.get(item.projectId)
    const refined = await runStructured(this.runner(item, 'refine'), {
      prompt: buildRefinePrompt({ brief: p.improvedBrief, brand }),
      schema: RefinedContentSchema,
    })
    this.deps.pipeline.patch(id, { refinedContent: refined })
    this.deps.setStatus(id, 'content_refined')
    return refined
  }

  async runAiReview(id: string): Promise<AiReview> {
    const item = this.requireItem(id)
    const p = this.deps.pipeline.get(id)
    if (!p.refinedContent) throw new Error('Cannot review before refined content exists.')
    const brand = this.deps.brand.get(item.projectId)
    const review = await runStructured(this.runner(item, 'ai_review'), {
      prompt: buildReviewPrompt({ refined: p.refinedContent, brand, niche: brand?.nichePositioning }),
      schema: AiReviewSchema,
    })
    this.deps.pipeline.patch(id, { aiReview: review })
    if (review.decision === 'approved') {
      this.deps.setStatus(id, 'human_review')
    } else {
      this.deps.lessons.create({
        projectId: item.projectId, contentId: id, source: 'ai_review',
        type: 'content_quality',
        reason: review.rejectionReason ?? 'AI review rejected the content.',
        whatWentWrong: review.rejectionReason ?? 'Unspecified.',
        howToImprove: review.improvementInstruction ?? 'Improve per the rejection reason.',
      })
      this.deps.setStatus(id, 'brief')
    }
    return review
  }

  async submitHumanReview(id: string, input: { decision: 'approved' | 'rejected'; reason?: string; type?: LessonType }): Promise<HumanReview> {
    const item = this.requireItem(id)
    const review: HumanReview = { decision: input.decision, reason: input.reason, reviewedAt: Date.now() }
    if (input.decision === 'rejected') {
      if (!input.reason?.trim()) throw new Error('A rejection reason is required.')
      this.deps.lessons.create({
        projectId: item.projectId, contentId: id, source: 'human_review',
        type: input.type ?? 'content_quality',
        reason: input.reason, whatWentWrong: input.reason,
        howToImprove: `Human reviewer says: ${input.reason}`,
      })
      this.deps.pipeline.patch(id, { humanReview: review })
      this.deps.setStatus(id, 'brief')
    } else {
      this.deps.pipeline.patch(id, { humanReview: review })
      // Phase 2 will set 'generating'. Phase 1 leaves status at human_review (approved/ready).
      this.deps.setStatus(id, 'human_review')
    }
    return review
  }

  /** Auto-run: breakdown → refine → ai review, looping on rejection up to maxAutoIterations. */
  async runAuto(id: string): Promise<AutoResult> {
    this.deps.pipeline.resetIteration(id)
    let iterations = 0
    // first pass
    for (;;) {
      await this.runBreakdown(id)
      await this.runRefine(id)
      const review = await this.runAiReview(id)
      iterations++
      if (review.decision === 'approved') {
        return { finalStatus: 'human_review', stoppedReason: 'human_review', iterations }
      }
      this.deps.pipeline.incrementIteration(id)
      if (iterations >= this.deps.maxAutoIterations) {
        return { finalStatus: 'brief', stoppedReason: 'max_iterations', iterations }
      }
    }
  }

  private requireItem(id: string): PipelineItem {
    const item = this.deps.getItem(id)
    if (!item) throw new Error(`content item ${id} not found`)
    return item
  }
}
```

> Note: the rejection lesson `type` defaults to `content_quality`; future refinement can map review categories to specific `LessonType`s. This satisfies the spec's "every rejection creates a lesson" rule.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/backend/tests/content-pipeline/pipeline-service.test.ts --maxWorkers=2`
Expected: PASS (all cases).

- [ ] **Step 5: Add the barrel**

Create `packages/backend/src/content-pipeline/index.ts`:

```ts
export * from './json.js'
export * from './schemas.js'
export * from './raw-extract.js'
export * from './pipeline-service.js'
```

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/content-pipeline/pipeline-service.ts packages/backend/src/content-pipeline/index.ts packages/backend/tests/content-pipeline/pipeline-service.test.ts
git commit -m "feat(backend): content pipeline service with lessons, transitions, loop guard"
```

---

## Task 11: Wire the pipeline service to the real stack (factory)

**Files:**
- Create: `packages/backend/src/content-pipeline/factory.ts`
- Modify: `packages/backend/src/content-pipeline/index.ts` (export factory)

No unit test — this is pure wiring of already-tested units to the live `getStack()` + agent service + extractor. It is exercised by the route tests in Task 13.

- [ ] **Step 1: Implement the factory**

```ts
import { createAiAgentService } from '@anubis/ai-agent'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getStack, getDataDir } from '../services.js'
import { ContentPipelineService, type PipelineDeps } from './pipeline-service.js'
import { makeRealTranscriber } from './raw-extract.js'

const agentService = createAiAgentService()

const MAX_AUTO_ITERATIONS = 3

export function getPipelineService(): ContentPipelineService {
  const stack = getStack()
  const dataDir = getDataDir()

  const deps: PipelineDeps = {
    getItem: (id) => {
      const item = stack.contentItems.findById(id)
      if (!item) return null
      return { id: item.id, projectId: item.projectId ?? 'default', status: item.status, referencePostId: item.referencePostId, referenceUrl: item.referenceUrl }
    },
    setStatus: (id, status) => { stack.contentItems.update(id, { status: status as never }) },
    pipeline: stack.contentPipeline,
    lessons: stack.contentLessons,
    brand: { get: (projectId) => stack.brandContext.get(projectId) },
    kbSearch: async () => [], // Phase 1: KB injection optional/empty; wire knowledge-base.contextPack later.
    runAgent: async ({ prompt, cwd, projectId, step }) => {
      const workDir = join(dataDir, 'content-pipeline', cwd.split('/').pop() ?? 'scratch')
      mkdirSync(workDir, { recursive: true })
      const model = step === 'ai_review' ? 'claude-opus' : undefined
      const res = await agentService.runAgent({
        agent: 'claude', cwd: workDir, prompt, model,
        permissionMode: 'bypassPermissions', workspaceId: projectId,
      })
      return res.text
    },
    maxAutoIterations: MAX_AUTO_ITERATIONS,
  }

  return new ContentPipelineService(deps)
}

export function getTranscriber() {
  return makeRealTranscriber()
}
```

> If `'claude-opus'` is not a valid model id in the catalog, drop the `model` override (leave `undefined`) — confirm against `loadCatalogModels()`/`models.json`. The default `claude` agent is sufficient for Phase 1.

- [ ] **Step 2: Export from the barrel**

Add to `index.ts`: `export * from './factory.js'`

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @anubis/conversation build && pnpm --filter @anubis/backend typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/content-pipeline/factory.ts packages/backend/src/content-pipeline/index.ts
git commit -m "feat(backend): pipeline service factory wired to stack + agent service"
```

---

## Task 12: Route — save a research candidate as an idea

**Files:**
- Modify: `packages/backend/src/content-items.ts`
- Test: `packages/backend/tests/content-pipeline-routes.test.ts` (start the file here)

- [ ] **Step 1: Write the failing test**

Follow the harness in `packages/backend/tests/content-items.test.ts` (it builds an app + a temp stack). Reuse its setup. Add:

```ts
// in packages/backend/tests/content-pipeline-routes.test.ts
import { describe, expect, it, beforeEach } from 'vitest'
import { makeTestApp } from './helpers/app.js' // reuse/extract the harness used by content-items.test.ts

describe('POST /content-items/from-candidate', () => {
  it('creates an idea carrying the candidate id and reference', async () => {
    const { app, stack } = await makeTestApp()
    // seed a competitor + captured post + candidate via the stack (copy the seeding helper from research-routes.test.ts)
    const { candidateId, postId } = await seedCandidate(stack)
    const res = await app.request('/content-items/from-candidate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ candidateId }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.item.status).toBe('idea')
    expect(body.item.sourceCandidateId).toBe(candidateId)
    expect(body.item.referencePostId).toBe(postId)
  })
})
```

> `seedCandidate` should insert a competitor, a captured post, and a `research_candidates` row (use `stack.capturedPosts` / the research candidates repo). Mirror seeding in `packages/backend/tests/research-routes.test.ts`. If a shared `makeTestApp` harness doesn't exist, extract one from `content-items.test.ts` into `tests/helpers/app.ts` as part of this step.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @anubis/conversation build && pnpm vitest run packages/backend/tests/content-pipeline-routes.test.ts --maxWorkers=2`
Expected: FAIL (404 — route not registered).

- [ ] **Step 3: Implement the route**

In `content-items.ts`, register **before** the `/:id` routes:

```ts
const FromCandidateBody = z.object({
  candidateId: z.string().min(1),
  projectId: z.string().min(1).optional(),
}).strict()

contentItemRoutes.post('/from-candidate', async (c) => {
  const stack = getStack()
  const body = FromCandidateBody.parse(await c.req.json())
  const candidate = stack.research.candidates.findById(body.candidateId)
  if (!candidate) return c.json({ ok: false, error: 'candidate_not_found' }, 404)

  const post = stack.capturedPosts.findById(candidate.postId)
  const projectId = body.projectId ?? candidate.projectId ?? 'default'
  const title = (candidate.caption?.trim() || `Idea from ${candidate.competitorId}`).slice(0, 80)

  const item = stack.contentItems.create({
    id: randomUUID(),
    projectId,
    referencePostId: post ? candidate.postId : undefined,
    referenceUrl: post ? undefined : candidate.postUrl,
    title,
    status: 'idea',
    sourceCandidateId: candidate.id,
    rawBrief: candidate.caption ? `Reference: ${candidate.caption}` : undefined,
    now: Date.now(),
  })
  return c.json({ ok: true, item: toSummary(item) }, 201)
})
```

> Confirm the candidates repo accessor on the stack. From `index.ts`, research is grouped — check whether it is `stack.research.candidates` or a top-level `stack.researchCandidates`. Use whichever the stack exposes. Also confirm `CreateContentItemInput` permits `referencePostId` without `referenceUrl`; the repo already allows either.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/backend/tests/content-pipeline-routes.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/content-items.ts packages/backend/tests/content-pipeline-routes.test.ts packages/backend/tests/helpers/app.ts
git commit -m "feat(backend): save research candidate as content idea"
```

---

## Task 13: Routes — extract, pipeline run/step, get pipeline, human review

**Files:**
- Modify: `packages/backend/src/content-items.ts`
- Test: extend `packages/backend/tests/content-pipeline-routes.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that drive the routes with a **fake pipeline service injected** so no real agent runs. The cleanest seam: have `content-items.ts` import `getPipelineService` and `getTranscriber` from the pipeline factory, and allow tests to override them via a setter (e.g. `__setPipelineProviderForTests`). Add:

```ts
describe('pipeline routes', () => {
  it('GET /content-items/:id/pipeline returns the stored artifacts', async () => {
    const { app, stack } = await makeTestApp()
    const item = stack.contentItems.create({ id: 'c1', projectId: 'default', referenceUrl: 'u', title: 'T', status: 'raw_extracted', now: Date.now() })
    stack.contentPipeline.patch('c1', { rawIdea: { caption: 'cap', assetRefs: [] } })
    const res = await app.request(`/content-items/${item.id}/pipeline`)
    expect(res.status).toBe(200)
    expect((await res.json()).pipeline.rawIdea.caption).toBe('cap')
  })

  it('POST /content-items/:id/human-review rejects without a reason', async () => {
    const { app, stack } = await makeTestApp()
    stack.contentItems.create({ id: 'c1', projectId: 'default', referenceUrl: 'u', title: 'T', status: 'human_review', now: Date.now() })
    const res = await app.request('/content-items/c1/human-review', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'rejected' }),
    })
    expect(res.status).toBe(400)
  })
})
```

> Decide the injection seam now and use it consistently. Simplest: export `let pipelineProvider = getPipelineService` and `export function __setPipelineProviderForTests(fn)`. The `human-review` validation (reason required on reject) is enforced by `submitHumanReview`, surfaced as a 400 by the route's try/catch.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/backend/tests/content-pipeline-routes.test.ts --maxWorkers=2`
Expected: FAIL (routes missing → 404).

- [ ] **Step 3: Implement the routes**

In `content-items.ts` (after imports, add the provider seam, and register the routes before `/:id` sync-metrics is fine since these are `/:id/...` distinct paths — but register `/from-candidate` before any `/:id`):

```ts
import { getPipelineService, getTranscriber } from './content-pipeline/index.js'
import { buildRawIdea } from './content-pipeline/raw-extract.js'

let pipelineProvider = getPipelineService
export function __setPipelineProviderForTests(fn: typeof getPipelineService) { pipelineProvider = fn }

const HumanReviewBody = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().optional(),
  type: z.string().optional(),
}).strict()

const StepParam = z.enum(['breakdown', 'refine', 'ai-review'])

contentItemRoutes.post('/:id/extract', async (c) => {
  const stack = getStack()
  const item = stack.contentItems.findById(c.req.param('id'))
  if (!item) return c.json({ ok: false, error: 'not_found' }, 404)
  const post = item.referencePostId ? stack.capturedPosts.findById(item.referencePostId) ?? undefined : undefined
  const raw = await buildRawIdea({ post, referenceUrl: item.referenceUrl, transcribeMedia: getTranscriber() })
  stack.contentPipeline.patch(item.id, { rawIdea: raw, transcript: raw.transcript, transcriptSource: raw.transcript ? 'extractor' : undefined })
  stack.contentItems.update(item.id, { status: 'raw_extracted' })
  return c.json({ ok: true, pipeline: stack.contentPipeline.get(item.id) })
})

contentItemRoutes.get('/:id/pipeline', (c) => {
  const stack = getStack()
  if (!stack.contentItems.findById(c.req.param('id'))) return c.json({ ok: false, error: 'not_found' }, 404)
  return c.json({ ok: true, pipeline: stack.contentPipeline.get(c.req.param('id')), lessons: stack.contentLessons.listByContent(c.req.param('id')) })
})

contentItemRoutes.post('/:id/pipeline/run', (c) => {
  const id = c.req.param('id')
  if (!getStack().contentItems.findById(id)) return c.json({ ok: false, error: 'not_found' }, 404)
  const job = jobManager.runJob({ kind: 'content-pipeline', label: `Pipeline · ${id}` }, async () => {
    return pipelineProvider().runAuto(id)
  })
  return c.json({ ok: true, jobId: job.id })
})

contentItemRoutes.post('/:id/pipeline/step/:step', async (c) => {
  const id = c.req.param('id')
  const step = StepParam.parse(c.req.param('step'))
  const svc = pipelineProvider()
  if (step === 'breakdown') return c.json({ ok: true, brief: await svc.runBreakdown(id) })
  if (step === 'refine') return c.json({ ok: true, refined: await svc.runRefine(id) })
  return c.json({ ok: true, review: await svc.runAiReview(id) })
})

contentItemRoutes.post('/:id/human-review', async (c) => {
  const body = HumanReviewBody.parse(await c.req.json())
  try {
    const review = await pipelineProvider().submitHumanReview(c.req.param('id'), {
      decision: body.decision, reason: body.reason, type: body.type as never,
    })
    return c.json({ ok: true, review })
  } catch (err) {
    return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: err instanceof Error ? err.message : 'failed' } }, 400)
  }
})
```

> Add `'content-pipeline'` to the `JobKind` union in `jobs.ts` if it is a closed enum (check the type). `jobManager` is already imported in some backend files; import it here too. Confirm route registration order: `/from-candidate` must precede `/:id`; the `/:id/...` sub-paths don't collide with `/:id`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/backend/tests/content-pipeline-routes.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/content-items.ts packages/backend/src/jobs.ts packages/backend/tests/content-pipeline-routes.test.ts
git commit -m "feat(backend): pipeline extract/run/step/human-review routes"
```

---

## Task 14: Routes — lessons + brand context

**Files:**
- Modify: `packages/backend/src/content-items.ts` (lessons), `packages/backend/src/app.ts` (mount brand routes) or add to content-items.
- Create: `packages/backend/src/brand-context.ts`
- Test: extend `packages/backend/tests/content-pipeline-routes.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe('lessons + brand context', () => {
  it('GET /lessons returns project lessons', async () => {
    const { app, stack } = await makeTestApp()
    stack.contentLessons.create({ projectId: 'default', contentId: 'c1', source: 'ai_review', type: 'tone_of_voice', reason: 'r', whatWentWrong: 'w', howToImprove: 'h' })
    const res = await app.request('/lessons?projectId=default')
    expect(res.status).toBe(200)
    expect((await res.json()).lessons).toHaveLength(1)
  })

  it('PUT then GET /brand-context round-trips', async () => {
    const { app } = await makeTestApp()
    const put = await app.request('/brand-context?projectId=default', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brandGuideline: 'BG', toneOfVoice: 'T', targetAudience: 'A', nichePositioning: 'N', contentRules: 'C' }),
    })
    expect(put.status).toBe(200)
    const get = await app.request('/brand-context?projectId=default')
    expect((await get.json()).brandContext.brandGuideline).toBe('BG')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/backend/tests/content-pipeline-routes.test.ts --maxWorkers=2`
Expected: FAIL (routes missing).

- [ ] **Step 3: Implement lessons route (in content-items.ts) + brand-context route module**

Lessons (a top-level route — register on a small `lessonRoutes` Hono or add to an existing top-level router; here add a new router mounted at `/lessons`):

`packages/backend/src/brand-context.ts`:

```ts
import { Hono } from 'hono'
import { z } from 'zod'
import { getStack } from './services.js'

const BrandBody = z.object({
  brandGuideline: z.string().default(''),
  toneOfVoice: z.string().default(''),
  targetAudience: z.string().default(''),
  nichePositioning: z.string().default(''),
  contentRules: z.string().default(''),
}).strict()

export const brandContextRoutes = new Hono()

brandContextRoutes.get('/', (c) => {
  const projectId = new URL(c.req.url).searchParams.get('projectId') ?? 'default'
  return c.json({ ok: true, brandContext: getStack().brandContext.get(projectId) })
})

brandContextRoutes.put('/', async (c) => {
  const projectId = new URL(c.req.url).searchParams.get('projectId') ?? 'default'
  const fields = BrandBody.parse(await c.req.json())
  return c.json({ ok: true, brandContext: getStack().brandContext.save(projectId, fields) })
})

export const lessonRoutes = new Hono()
lessonRoutes.get('/', (c) => {
  const projectId = new URL(c.req.url).searchParams.get('projectId') ?? 'default'
  return c.json({ ok: true, lessons: getStack().contentLessons.listByProject(projectId) })
})
```

Mount in `app.ts` (next to the other `.route(...)` calls):

```ts
import { brandContextRoutes, lessonRoutes } from './brand-context.js'
app.route('/brand-context', brandContextRoutes)
app.route('/lessons', lessonRoutes)
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/backend/tests/content-pipeline-routes.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Run the whole backend pipeline test file + typecheck**

Run: `pnpm --filter @anubis/backend typecheck && pnpm vitest run packages/backend/tests/content-pipeline-routes.test.ts packages/backend/tests/content-pipeline --maxWorkers=2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/brand-context.ts packages/backend/src/app.ts packages/backend/tests/content-pipeline-routes.test.ts
git commit -m "feat(backend): lessons and brand-context routes"
```

---

## Task 15: Frontend API client functions

**Files:**
- Modify: `packages/frontend/src/api.ts`

- [ ] **Step 1: Add the client functions**

Append to `api.ts` (using the existing `api<T>()` helper):

```ts
import type {
  AiReview, BrandContext, ContentLesson, ContentPipeline, HumanReview,
  ImprovedBrief, RefinedContent,
} from '@anubis/shared'

export async function saveCandidateAsIdea(candidateId: string, projectId?: string) {
  const r = await api<{ ok: true; item: import('@anubis/shared').ContentItemSummary }>('/content-items/from-candidate', {
    method: 'POST', body: JSON.stringify({ candidateId, projectId }),
  })
  return r.item
}

export async function extractRawIdea(id: string) {
  const r = await api<{ ok: true; pipeline: ContentPipeline }>(`/content-items/${encodeURIComponent(id)}/extract`, { method: 'POST' })
  return r.pipeline
}

export async function getContentPipeline(id: string) {
  const r = await api<{ ok: true; pipeline: ContentPipeline; lessons: ContentLesson[] }>(`/content-items/${encodeURIComponent(id)}/pipeline`)
  return r
}

export async function runPipeline(id: string) {
  const r = await api<{ ok: true; jobId: string }>(`/content-items/${encodeURIComponent(id)}/pipeline/run`, { method: 'POST' })
  return r.jobId
}

export async function runPipelineStep(id: string, step: 'breakdown' | 'refine' | 'ai-review') {
  return api<{ ok: true; brief?: ImprovedBrief; refined?: RefinedContent; review?: AiReview }>(
    `/content-items/${encodeURIComponent(id)}/pipeline/step/${step}`, { method: 'POST' },
  )
}

export async function submitHumanReview(id: string, input: { decision: 'approved' | 'rejected'; reason?: string; type?: string }) {
  const r = await api<{ ok: true; review: HumanReview }>(`/content-items/${encodeURIComponent(id)}/human-review`, {
    method: 'POST', body: JSON.stringify(input),
  })
  return r.review
}

export async function listLessons(projectId?: string) {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  const r = await api<{ ok: true; lessons: ContentLesson[] }>(`/lessons${qs}`)
  return r.lessons
}

export async function getBrandContext(projectId?: string) {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  const r = await api<{ ok: true; brandContext: BrandContext }>(`/brand-context${qs}`)
  return r.brandContext
}

export async function saveBrandContext(projectId: string, fields: Omit<BrandContext, 'projectId' | 'updatedAt'>) {
  const r = await api<{ ok: true; brandContext: BrandContext }>(`/brand-context?projectId=${encodeURIComponent(projectId)}`, {
    method: 'PUT', body: JSON.stringify(fields),
  })
  return r.brandContext
}
```

> If `api.ts` already imports from `@anubis/shared`, merge into the existing import rather than adding a duplicate import line.

- [ ] **Step 2: Build shared + typecheck frontend**

Run: `pnpm --filter @anubis/shared build && pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/api.ts
git commit -m "feat(frontend): content pipeline API client functions"
```

---

## Task 16: Register the Content Studio page (stub) — 5 spots

**Files:**
- Modify: `packages/frontend/src/lib/navigation.tsx`
- Modify: `packages/frontend/src/components/dashboard/data.ts`
- Modify: `packages/frontend/src/components/dashboard/index.tsx`
- Modify: `packages/frontend/src/components/dashboard/sidebar.tsx`
- Create: `packages/frontend/src/pages/content-studio.tsx`

- [ ] **Step 1: Add the route**

`navigation.tsx` — add to the `Route` union:

```ts
  | { page: 'content-studio' }
```

- [ ] **Step 2: Add the sidebar entry**

`data.ts` — add to the nav items array (near the `'planner'` entry), importing a Lucide icon already in scope (e.g. `SparklesIcon`/`WandSparklesIcon`):

```ts
  { label: 'Content Studio', icon: WandSparklesIcon, page: 'content-studio' },
```

(Ensure the icon is imported at the top of `data.ts`.)

- [ ] **Step 3: Add the route → component mapping + breadcrumb**

`dashboard/index.tsx` — import and add a `case`:

```ts
import { ContentStudioPage } from '@/pages/content-studio'
// ...
    case 'content-studio':
      return <ContentStudioPage />
```

Add a `BREADCRUMBS['content-studio']` entry mirroring the others (e.g. `['Content Studio']` or whatever shape that map uses).

- [ ] **Step 4: Handle the sidebar section switch**

`sidebar.tsx` — the switch around line 75 maps page → section/group. Add a `case 'content-studio':` returning the same group the other content pages use (copy the `'planner'` case).

- [ ] **Step 5: Create the stub page**

`content-studio.tsx`:

```tsx
export function ContentStudioPage() {
  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden bg-background'>
      <div className='border-b border-border px-6 py-4'>
        <h1 className='text-[24px] font-semibold tracking-[-0.02em]'>Content Studio</h1>
        <p className='mt-1 text-[13px] text-muted-foreground'>Turn a validated idea into a reviewed draft.</p>
      </div>
      <div className='p-6 text-sm text-muted-foreground'>Coming together…</div>
    </div>
  )
}
```

- [ ] **Step 6: Typecheck (proves all 5 spots are wired)**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS. (A missing case in the `Route` union or switches would surface here — except the silent default branches; visually confirm the sidebar shows "Content Studio" in Step 7's run.)

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/lib/navigation.tsx packages/frontend/src/components/dashboard/data.ts packages/frontend/src/components/dashboard/index.tsx packages/frontend/src/components/dashboard/sidebar.tsx packages/frontend/src/pages/content-studio.tsx
git commit -m "feat(frontend): register Content Studio page"
```

---

## Task 17: Content Studio page — list rail + pipeline sections

**Files:**
- Modify: `packages/frontend/src/pages/content-studio.tsx`
- Create: `packages/frontend/src/pages/content-studio/sections.tsx` (section components)
- Create: `packages/frontend/src/pages/content-studio/brand-context-dialog.tsx`

Build incrementally; this task is UI assembly using the same styling/components as `planner.tsx` (reuse `primaryButton`/`secondaryButton`/`Field`/`EditorBlock` patterns; import `Sheet`/`Dialog` from `@/components/ui`). No vitest (frontend page); verified by typecheck + manual run.

- [ ] **Step 1: Left rail + selection + data load**

Implement the page shell: load `listContentItems({ projectId })`, split into "Ideas" (`status === 'idea'`) and "In progress" (statuses `raw_extracted, brief, content_refined, ai_review, human_review`). Left rail lists both groups showing title, source competitor (`referencePost?.competitorHandle`), platform, candidate level (if present on the item via referencePost), research score, niche, created date, status chip. Selecting an item calls `getContentPipeline(id)` and stores `{ pipeline, lessons }` in state.

```tsx
const [items, setItems] = useState<ContentItemSummary[]>([])
const [selectedId, setSelectedId] = useState<string | null>(null)
const [data, setData] = useState<{ pipeline: ContentPipeline; lessons: ContentLesson[] } | null>(null)
// load items on mount/project change; load pipeline on select; expose refresh()
```

- [ ] **Step 2: Top controls**

Add buttons wired to the API:
- "Extract raw idea" → `extractRawIdea(id)` then refresh.
- "Run to human review" → `runPipeline(id)` → poll the jobs SSE/`GET /jobs/:id` until done, then refresh (reuse the existing job-polling hook if one exists, e.g. `useJobs`; otherwise poll `GET /jobs/:id`).
- Per-step: "Re-run breakdown / refine / AI review" → `runPipelineStep(id, step)` then refresh.
- "Edit Brand Context" → opens the brand dialog.

- [ ] **Step 3: Section components**

In `sections.tsx`, export read-mostly section components, each taking the relevant slice:
- `RawIdeaSection({ raw })` — caption, assets, transcript, source URL, competitor, metadata.
- `BriefSection({ brief, lessons })` — the brief fields + "lessons used".
- `RefinedSection({ refined })` — caption, visual brief, copywriting, hashtags, platform notes.
- `AiReviewSection({ review })` — decision badge, score, checklist, rejection reason.
- `HumanReviewSection({ item, review, onSubmit })` — approve / reject-with-reason form calling `submitHumanReview`.
- `LessonHistorySection({ lessons })` — list.
- `GenerationPlaceholder()` and `DraftPlaceholder()` — disabled "Phase 2" cards.

Render them in `content-studio.tsx` gated on which artifacts exist (e.g. show `BriefSection` only when `pipeline.improvedBrief`).

- [ ] **Step 4: Brand Context dialog**

`brand-context-dialog.tsx` — a `Dialog` with 5 textareas (guideline, tone, audience, niche, content rules) loaded via `getBrandContext(projectId)` and saved via `saveBrandContext`.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS.

- [ ] **Step 6: Build the frontend to catch runtime/import issues**

Run: `pnpm --filter @anubis/frontend build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/pages/content-studio.tsx packages/frontend/src/pages/content-studio/
git commit -m "feat(frontend): Content Studio pipeline page"
```

---

## Task 18: Extend the Planner page for the new statuses

**Files:**
- Modify: `packages/frontend/src/pages/planner.tsx:40-60`

- [ ] **Step 1: Add the new statuses to the three maps**

Update `STATUSES`, `STATUS_LABEL`, and `STATUS_TONE` so the existing kanban/table render the new statuses without a missing-key crash:

```ts
const STATUSES: ContentItemStatus[] = ['idea', 'raw_extracted', 'brief', 'content_refined', 'ai_review', 'human_review', 'generating', 'draft', 'review', 'scheduled', 'published', 'rejected']

const STATUS_LABEL: Record<ContentItemStatus, string> = {
  idea: 'Idea', raw_extracted: 'Raw', brief: 'Brief', content_refined: 'Refined',
  ai_review: 'AI Review', human_review: 'Human Review', generating: 'Generating',
  draft: 'Draft', review: 'Review', scheduled: 'Scheduled', published: 'Published', rejected: 'Rejected',
}

const STATUS_TONE: Record<ContentItemStatus, string> = {
  idea: 'border-border bg-muted/30 text-muted-foreground',
  raw_extracted: 'border-border bg-muted/40 text-muted-foreground',
  brief: 'border-[#4E6E8E]/40 bg-[#4E6E8E]/12 text-[#9db8d2]',
  content_refined: 'border-[#4E6E8E]/40 bg-[#4E6E8E]/12 text-[#9db8d2]',
  ai_review: 'border-[#7E5E92]/45 bg-[#7E5E92]/15 text-[#d9b7ec]',
  human_review: 'border-[#7E5E92]/45 bg-[#7E5E92]/15 text-[#d9b7ec]',
  generating: 'border-[var(--anubis-gold)]/40 bg-[var(--anubis-gold)]/10 text-[var(--anubis-gold)]',
  draft: 'border-[var(--anubis-gold)]/40 bg-[var(--anubis-gold)]/10 text-[var(--anubis-gold)]',
  review: 'border-[#7E5E92]/45 bg-[#7E5E92]/15 text-[#d9b7ec]',
  scheduled: 'border-[#3F8079]/45 bg-[#3F8079]/15 text-[#9bd8d0]',
  published: 'border-[var(--anubis-success)]/45 bg-[var(--anubis-success)]/12 text-[var(--anubis-success)]',
  rejected: 'border-destructive/45 bg-destructive/10 text-destructive',
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`
Expected: PASS (the `Record<ContentItemStatus, …>` maps now cover all 12 keys; a missing key would error here).

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/pages/planner.tsx
git commit -m "feat(frontend): planner supports new pipeline statuses"
```

---

## Task 19: "Save as idea" on research candidates

**Files:**
- Modify: the research candidates UI — find it: `grep -rn "candidate" packages/frontend/src/pages/research.tsx`. The candidate list/cards live there (or a sub-component).

- [ ] **Step 1: Add the button + handler**

On each validated candidate row/card, add a "Save as idea" button calling:

```tsx
import { saveCandidateAsIdea } from '@/api'
// onClick:
await saveCandidateAsIdea(candidate.id, activeProject?.id)
// then toast/banner "Saved to Content Planner"
```

Show it for candidates that are validated (mirror whatever "passed" condition the page already uses, e.g. `validationStatus === 'pass'`).

- [ ] **Step 2: Typecheck + build**

Run: `pnpm --filter @anubis/frontend typecheck && pnpm --filter @anubis/frontend build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/pages/research.tsx
git commit -m "feat(frontend): save validated candidate as content idea"
```

---

## Task 20: Full verification

- [ ] **Step 1: Build the load-bearing packages in order**

Run: `pnpm --filter @anubis/shared build && pnpm --filter @anubis/conversation build && pnpm --filter @anubis/backend build`
Expected: PASS.

- [ ] **Step 2: Typecheck everything**

Run: `pnpm typecheck`
Expected: PASS across all packages.

- [ ] **Step 3: Run the new + adjacent tests**

Run: `pnpm vitest run packages/conversation/tests/db packages/backend/tests/content-pipeline packages/backend/tests/content-pipeline-routes.test.ts packages/backend/tests/content-items.test.ts --maxWorkers=2`
Expected: PASS. (If you hit `ERR_DLOPEN_FAILED`/NODE_MODULE_VERSION on better-sqlite3, run `pnpm rebuild better-sqlite3` — it's an ABI mismatch, not a regression.)

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run the app (`pnpm dev`), open **Research**, "Save as idea" on a candidate, open **Content Studio**, select the idea, "Extract raw idea", then "Run to human review", and confirm the brief/refined/AI-review sections populate and status reaches `human_review` (or loops to `brief` after 3 rejections). Edit Brand Context and re-run to confirm injection.

- [ ] **Step 5: Final commit (if any fixups)**

```bash
git add -A
git commit -m "test: content creation workflow phase 1 verification fixups"
```

---

## Self-review notes (spec coverage)

- Status lifecycle `idea→raw_extracted→brief→content_refined→ai_review→human_review` + `rejected→brief` loop → Tasks 1, 6, 10. `generating`/`draft` enum values added (Task 1) but driven in Phase 2.
- Raw extraction incl. video transcript, no-OCR for image/carousel → Task 9.
- Breakdown→brief with brand/lesson/KB injection → Tasks 8, 10, 11.
- Refine → Tasks 8, 10. AI review approved/rejected + lesson + loop guard → Task 10.
- Human review approve/reject-requires-reason + lesson → Task 10, 13.
- Lesson system (sources/types, searchable, injectable) → Tasks 4, 10, 14.
- Brand context doc → Tasks 5, 14, 17.
- Save candidate → idea bridge → Tasks 12, 19.
- Dedicated page with the required sections (+ Phase-2 placeholders) → Tasks 16, 17.
- Data requirements (contentId, sourceCandidateId, status, rawIdea, improvedBrief, refinedContent, aiReview, humanReview, lessons, timestamps) → Tasks 1, 3, 6.
- Out of scope (generation queue, generators, draft stitching, draft output) → deferred to Phase 2, shown as placeholders.
