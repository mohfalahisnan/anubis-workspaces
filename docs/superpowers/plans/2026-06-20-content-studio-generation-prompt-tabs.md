# Content Studio — Generation Prompt Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Image and Video first-class tabs in the Content Studio Pipeline Settings dialog, each with a generation-profile picker AND an editable generation-prompt template; replace the hardcoded `buildImagePrompt` with a template render.

**Architecture:** Add a per-project `generation_prompts` column (migration 035) mirroring `generation_profiles`. A new `generation-prompts.ts` module holds `DEFAULT_GENERATION_TEMPLATES` + `renderImagePrompt`/`renderVideoPrompt`; `deriveTasks` renders `projectTemplate ?? default` to build each media task's `inputPrompt` (the single source for both Manual copy text and the auto-generation agent). `enqueue` reads per-project prompt templates and passes them through. The dialog gains Image/Video tabs that render a single-media picker + a prompt editor.

**Tech Stack:** TypeScript (ESM), better-sqlite3, Hono, React 19 + Vite, Vitest + @testing-library/react.

**Spec:** [docs/superpowers/specs/2026-06-20-content-studio-generation-prompt-tabs-design.md](../specs/2026-06-20-content-studio-generation-prompt-tabs-design.md)

**Builds on:** the merged per-project `generationProfiles` work (migration 034, repo `put(projectId, steps, generationProfiles)`, route, factory `effectiveProfiles`, `getGenerationProfiles` dep, page-level `GenerationProfilePicker`).

---

## Cross-package build note (read once)

Vitest resolves `@anubis/*` to each package's **dist**. After editing `packages/shared/src/index.ts` (Task 1), rebuild shared so downstream typecheck sees new types; after the conversation repo+migration change (Task 1), rebuild conversation so the backend route test (Task 4) sees them. Build command appears in Task 1. The conversation repo unit test imports source directly (no build needed for it).

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `packages/shared/src/index.ts` | `GenerationPromptConfig`, `GenerationPromptDefaults`, `PipelineSettings.generationPrompts` | Modify |
| `packages/conversation/src/db/migrations/035_content_pipeline_settings_generation_prompts.sql` | add column | Create |
| `packages/conversation/src/db/migrations/index.ts` | register 035 | Modify |
| `packages/conversation/src/db/repositories/content-pipeline-settings-repo.ts` | read/write column | Modify |
| `packages/conversation/tests/db/content-pipeline-settings-repo.test.ts` | repo round-trip | Modify |
| `packages/backend/src/content-generation/generation-prompts.ts` | defaults + render helpers | Create |
| `packages/backend/tests/content-generation/generation-prompts.test.ts` | render helper tests | Create |
| `packages/backend/src/content-generation/derive-tasks.ts` | render template (replaces buildImagePrompt) | Modify |
| `packages/backend/tests/content-generation/derive-tasks.test.ts` | template/default tests | Modify |
| `packages/backend/src/content-generation/generation-service.ts` | `getGenerationPrompts` dep | Modify |
| `packages/backend/src/content-generation/factory.ts` | wire prompts dep | Modify |
| `packages/backend/tests/content-generation/generation-service.test.ts` | dep default | Modify |
| `packages/backend/src/pipeline-settings.ts` | body + put + GET defaults | Modify |
| `packages/backend/tests/pipeline-settings.test.ts` | prompts round-trip | Modify |
| `packages/frontend/src/api.ts` | `updatePipelineSettings` + GET defaults | Modify |
| `packages/frontend/src/pages/content-studio/generation-profile-picker.tsx` | `MediaProfilePicker` (single) | Modify |
| `packages/frontend/src/pages/content-studio/media-generation-tab.tsx` | media tab body | Create |
| `packages/frontend/src/pages/content-studio/pipeline-settings-dialog.tsx` | Image/Video tabs | Modify |
| `packages/frontend/tests/pages/pipeline-settings-dialog.test.tsx` | tabs render + save | Modify |

---

## Task 1: Storage — types, migration, repo

**Files:**
- Modify: `packages/shared/src/index.ts`
- Create: `packages/conversation/src/db/migrations/035_content_pipeline_settings_generation_prompts.sql`
- Modify: `packages/conversation/src/db/migrations/index.ts`
- Modify: `packages/conversation/src/db/repositories/content-pipeline-settings-repo.ts`
- Test: `packages/conversation/tests/db/content-pipeline-settings-repo.test.ts`

- [ ] **Step 1: Update the repo tests**

In `packages/conversation/tests/db/content-pipeline-settings-repo.test.ts`, update the empty-settings expectation and add a prompts round-trip.

Replace:
```ts
  it('returns empty settings for an unknown project', () => {
    const repo = new ContentPipelineSettingsRepo(openMigratedDb())
    expect(repo.get('p1')).toEqual({ projectId: 'p1', steps: {}, generationProfiles: {}, updatedAt: 0 })
  })
```
with:
```ts
  it('returns empty settings for an unknown project', () => {
    const repo = new ContentPipelineSettingsRepo(openMigratedDb())
    expect(repo.get('p1')).toEqual({ projectId: 'p1', steps: {}, generationProfiles: {}, generationPrompts: {}, updatedAt: 0 })
  })

  it('persists and round-trips generation prompts', () => {
    const repo = new ContentPipelineSettingsRepo(openMigratedDb())
    repo.put('p1', {}, {}, { image: 'IMG {{concept}}', video: 'VID {{videoScript}}' })
    expect(repo.get('p1').generationPrompts).toEqual({ image: 'IMG {{concept}}', video: 'VID {{videoScript}}' })
  })

  it('keeps profiles and prompts independent on put', () => {
    const repo = new ContentPipelineSettingsRepo(openMigratedDb())
    repo.put('p1', {}, { image: 'manual' }, { image: 'IMG' })
    const s = repo.get('p1')
    expect(s.generationProfiles).toEqual({ image: 'manual' })
    expect(s.generationPrompts).toEqual({ image: 'IMG' })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/conversation/tests/db/content-pipeline-settings-repo.test.ts`
Expected: FAIL — `get` has no `generationPrompts`, `put` rejects a 4th arg.

- [ ] **Step 3: Add the shared types**

In `packages/shared/src/index.ts`, find the `GenerationProfileConfig` interface and add directly after it:
```ts
export interface GenerationPromptConfig {
  /** Per-project image/carousel generation prompt template override. */
  image?: string
  /** Per-project video generation prompt template override. */
  video?: string
}

/** Shipped default generation-prompt templates, surfaced so the UI can show/reset them. */
export interface GenerationPromptDefaults {
  image: string
  video: string
}
```
Then change `PipelineSettings` to add the field (between `generationProfiles` and `updatedAt`):
```ts
export interface PipelineSettings {
  projectId: string
  steps: Partial<Record<PipelineAiStep, PipelineStepSettings>>
  generationProfiles?: GenerationProfileConfig
  generationPrompts?: GenerationPromptConfig
  updatedAt: number
}
```

- [ ] **Step 4: Create the migration**

Create `packages/conversation/src/db/migrations/035_content_pipeline_settings_generation_prompts.sql`:
```sql
-- Per-project Content Studio generation-prompt template overrides (image / video),
-- stored as a JSON blob alongside steps + generation profiles.
ALTER TABLE content_pipeline_settings
  ADD COLUMN generation_prompts TEXT NOT NULL DEFAULT '{}';
```

- [ ] **Step 5: Register it**

In `packages/conversation/src/db/migrations/index.ts`, add after the `load(34, …)` line:
```ts
  load(35, '035_content_pipeline_settings_generation_prompts.sql'),
```

- [ ] **Step 6: Update the repo**

In `packages/conversation/src/db/repositories/content-pipeline-settings-repo.ts`:

Change the import:
```ts
import type { GenerationProfileConfig, GenerationPromptConfig, PipelineAiStep, PipelineSettings, PipelineStepSettings } from '@anubis/shared'
```
Add `generation_prompts: string | null` to the `Row` interface:
```ts
interface Row {
  project_id: string
  steps: string | null
  generation_profiles: string | null
  generation_prompts: string | null
  updated_at: number
}
```
Replace `get` and `put`:
```ts
  get(projectId: string): PipelineSettings {
    const row = this.db
      .prepare('SELECT * FROM content_pipeline_settings WHERE project_id = ?')
      .get(projectId) as Row | undefined
    if (!row) return { projectId, steps: {}, generationProfiles: {}, generationPrompts: {}, updatedAt: 0 }
    return {
      projectId,
      steps: parseJson<Steps>(row.steps, {}),
      generationProfiles: parseJson<GenerationProfileConfig>(row.generation_profiles, {}),
      generationPrompts: parseJson<GenerationPromptConfig>(row.generation_prompts, {}),
      updatedAt: row.updated_at,
    }
  }

  /** Replace the per-step overrides, generation profiles, and generation prompts for a project. */
  put(
    projectId: string,
    steps: Steps,
    generationProfiles: GenerationProfileConfig = {},
    generationPrompts: GenerationPromptConfig = {},
  ): PipelineSettings {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO content_pipeline_settings (project_id, steps, generation_profiles, generation_prompts, updated_at)
      VALUES (@projectId, @steps, @generationProfiles, @generationPrompts, @updatedAt)
      ON CONFLICT(project_id) DO UPDATE SET
        steps = @steps, generation_profiles = @generationProfiles, generation_prompts = @generationPrompts, updated_at = @updatedAt
    `).run({
      projectId,
      steps: JSON.stringify(steps ?? {}),
      generationProfiles: JSON.stringify(generationProfiles ?? {}),
      generationPrompts: JSON.stringify(generationPrompts ?? {}),
      updatedAt: now,
    })
    return { projectId, steps: steps ?? {}, generationProfiles: generationProfiles ?? {}, generationPrompts: generationPrompts ?? {}, updatedAt: now }
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run packages/conversation/tests/db/content-pipeline-settings-repo.test.ts`
Expected: PASS.

- [ ] **Step 8: Rebuild shared + conversation**

Run: `pnpm --filter @anubis/shared build && pnpm --filter @anubis/conversation build`
Expected: both succeed.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/index.ts packages/conversation/src/db/migrations/035_content_pipeline_settings_generation_prompts.sql packages/conversation/src/db/migrations/index.ts packages/conversation/src/db/repositories/content-pipeline-settings-repo.ts packages/conversation/tests/db/content-pipeline-settings-repo.test.ts
git commit -m "feat(content-studio): store per-project generation prompt templates"
```

---

## Task 2: Generation templates + deriveTasks render

**Files:**
- Create: `packages/backend/src/content-generation/generation-prompts.ts`
- Test: `packages/backend/tests/content-generation/generation-prompts.test.ts`
- Modify: `packages/backend/src/content-generation/derive-tasks.ts`
- Test: `packages/backend/tests/content-generation/derive-tasks.test.ts`

- [ ] **Step 1: Write the generation-prompts test**

Create `packages/backend/tests/content-generation/generation-prompts.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { RefinedContent } from '@anubis/shared'
import { DEFAULT_GENERATION_TEMPLATES, renderImagePrompt, renderVideoPrompt } from '../../src/content-generation/generation-prompts.js'

const refined = (over: Partial<RefinedContent> = {}): RefinedContent => ({
  caption: 'Cap',
  visualBrief: { concept: 'C', sceneDirection: 'S', subject: 'Subj', layout: 'L', mood: 'M', style: 'St', keyElements: ['k1', 'k2'] },
  copywriting: { hook: 'h', body: 'b', cta: 'c' },
  hashtags: { primary: ['#a'], niche: [], brandSafe: [] },
  ...over,
})

describe('generation prompt rendering', () => {
  it('default image template includes subject, style, and joined key elements', () => {
    const out = renderImagePrompt(DEFAULT_GENERATION_TEMPLATES.image, refined().visualBrief)
    expect(out).toContain('Subj')
    expect(out).toContain('St')
    expect(out).toContain('k1, k2')
  })

  it('image template renders the slide placeholder for carousel', () => {
    const out = renderImagePrompt('Slide: {{slide}}', refined().visualBrief, 'slide one')
    expect(out).toBe('Slide: slide one')
  })

  it('custom image template renders only requested placeholders', () => {
    expect(renderImagePrompt('Make {{subject}} in {{style}}', refined().visualBrief)).toBe('Make Subj in St')
  })

  it('video template renders videoScript, falling back to concept', () => {
    const withScript = refined({ copywriting: { hook: 'h', body: 'b', cta: 'c', videoScript: 'read this' } })
    expect(renderVideoPrompt(DEFAULT_GENERATION_TEMPLATES.video, withScript)).toBe('read this')
    expect(renderVideoPrompt(DEFAULT_GENERATION_TEMPLATES.video, refined())).toBe('C') // falls back to concept
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/backend/tests/content-generation/generation-prompts.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the module**

Create `packages/backend/src/content-generation/generation-prompts.ts`:
```ts
import type { GenerationPromptDefaults, RefinedContent, VisualBrief } from '@anubis/shared'
import { renderPrompt } from '../content-pipeline/prompts.js'

/** Shipped default generation-prompt templates (editable per-project in Pipeline Settings). */
export const DEFAULT_GENERATION_TEMPLATES: GenerationPromptDefaults = {
  image: [
    '{{concept}}',
    '{{sceneDirection}}',
    'Subject: {{subject}}',
    'Layout: {{layout}}',
    'Mood: {{mood}}',
    'Style: {{style}}',
    'Key elements: {{keyElements}}',
    'Text overlay: {{textOverlay}}',
    'Slide: {{slide}}',
    'Avoid: {{negativeDirection}}',
  ].join('\n'),
  video: '{{videoScript}}',
}

/** Render an image/carousel generation prompt from the Refine step's visual brief. */
export function renderImagePrompt(template: string, v: VisualBrief, slide = ''): string {
  return renderPrompt(template, {
    concept: v.concept,
    sceneDirection: v.sceneDirection,
    subject: v.subject,
    layout: v.layout,
    mood: v.mood,
    style: v.style,
    keyElements: v.keyElements.join(', '),
    textOverlay: v.textOverlay ?? '',
    slide,
    negativeDirection: v.negativeDirection ?? '',
  }).trim()
}

/** Render a video generation prompt; videoScript falls back to the visual concept. */
export function renderVideoPrompt(template: string, refined: RefinedContent): string {
  return renderPrompt(template, {
    videoScript: refined.copywriting.videoScript || refined.visualBrief.concept,
    concept: refined.visualBrief.concept,
  }).trim()
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run packages/backend/tests/content-generation/generation-prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the derive-tasks tests**

In `packages/backend/tests/content-generation/derive-tasks.test.ts`:
- Change the import line `import { deriveTasks, buildImagePrompt } from '../../src/content-generation/derive-tasks.js'` to:
  ```ts
  import { deriveTasks } from '../../src/content-generation/derive-tasks.js'
  ```
- Replace the existing `it('buildImagePrompt composes the visual brief', …)` test with two tests that exercise the new `prompts` param:
  ```ts
  it('renders a custom image template into the image task prompt', () => {
    const tasks = deriveTasks(refined(), 'image', {}, { image: 'Make {{subject}} in {{style}}' })
    expect(tasks.find((t) => t.type === 'image')?.inputPrompt).toBe('Make Subj in St')
  })

  it('renders the custom image template per carousel slide', () => {
    const r = refined({ copywriting: { hook: 'h', body: 'b', cta: 'c', carouselSlides: ['one', 'two'] } })
    const tasks = deriveTasks(r, 'carousel', {}, { image: 'Slide: {{slide}}' })
    expect(tasks.filter((t) => t.type === 'carousel').map((t) => t.inputPrompt)).toEqual(['Slide: one', 'Slide: two'])
  })

  it('renders a custom video template; default falls back to concept', () => {
    const r = refined({ copywriting: { hook: 'h', body: 'b', cta: 'c', videoScript: 'say hi' } })
    expect(deriveTasks(r, 'video', {}, { video: 'VID: {{videoScript}}' }).find((t) => t.type === 'video')?.inputPrompt).toBe('VID: say hi')
    expect(deriveTasks(refined(), 'video').find((t) => t.type === 'video')?.inputPrompt).toBe('C')
  })

  it('uses the default image template when no prompt override is given', () => {
    const out = deriveTasks(refined(), 'image').find((t) => t.type === 'image')?.inputPrompt ?? ''
    expect(out).toContain('Subj')
    expect(out).toContain('St')
  })
  ```
  (Leave the existing manual/status tests unchanged — they pass `deriveTasks(refined(), 'image', { image: true })` and assert status, which still works.)

- [ ] **Step 6: Run derive-tasks tests to verify they fail**

Run: `pnpm vitest run packages/backend/tests/content-generation/derive-tasks.test.ts`
Expected: FAIL — `deriveTasks` ignores a 4th param and still uses `buildImagePrompt`; the `buildImagePrompt` import is gone.

- [ ] **Step 7: Update deriveTasks**

In `packages/backend/src/content-generation/derive-tasks.ts`:

Change the import line to add the shared type and the render helpers, and remove the `VisualBrief` import (no longer used here):
```ts
import type { GenerationCapability, GenerationPromptConfig, GenerationTaskStatus, GenerationTaskType, RefinedContent } from '@anubis/shared'
import { DEFAULT_GENERATION_TEMPLATES, renderImagePrompt, renderVideoPrompt } from './generation-prompts.js'
```

Delete the entire `buildImagePrompt` function (lines defining `export function buildImagePrompt(...) { ... }`).

Replace `deriveTasks` with:
```ts
export function deriveTasks(
  refined: RefinedContent,
  mediaKind: 'image' | 'video' | 'carousel' | undefined,
  manual: ManualMediaFlags = {},
  prompts: GenerationPromptConfig = {},
): TaskSpec[] {
  const tasks: TaskSpec[] = []

  // Text — carry-forward from the refined content.
  tasks.push(spec('final_caption', refined.caption))
  const hashtags = [...refined.hashtags.primary, ...refined.hashtags.niche, ...refined.hashtags.brandSafe]
  tasks.push(spec('final_hashtags', hashtags.join(' ')))

  const overlay = refined.visualBrief.textOverlay ?? refined.copywriting.textOverlay
  if (overlay) tasks.push(spec('text_overlay', overlay))

  // Visual. The prompt comes from the per-project template (or the shipped default),
  // rendered with the Refine step's visual brief. `manual.*` marks the task prompt-only.
  const imageTpl = prompts.image ?? DEFAULT_GENERATION_TEMPLATES.image
  const videoTpl = prompts.video ?? DEFAULT_GENERATION_TEMPLATES.video
  const imageStatus: GenerationTaskStatus = manual.image ? 'manual' : 'pending'
  if (mediaKind === 'carousel') {
    const slides = refined.copywriting.carouselSlides?.length ? refined.copywriting.carouselSlides : ['']
    for (const slide of slides) tasks.push(spec('carousel', renderImagePrompt(imageTpl, refined.visualBrief, slide), imageStatus))
  } else {
    tasks.push(spec('image', renderImagePrompt(imageTpl, refined.visualBrief), imageStatus))
  }

  // Video via the hyperframes agent generator unless opted out; voiceover stays manual.
  if (mediaKind === 'video') tasks.push(spec('video', renderVideoPrompt(videoTpl, refined), manual.video ? 'manual' : 'pending'))
  if (refined.copywriting.videoScript) tasks.push(spec('voiceover', refined.copywriting.videoScript, 'manual'))

  return tasks
}
```

- [ ] **Step 8: Run derive-tasks tests to verify they pass**

Run: `pnpm vitest run packages/backend/tests/content-generation/derive-tasks.test.ts`
Expected: PASS.

- [ ] **Step 9: Confirm no other references to `buildImagePrompt`**

Run: `grep -rn "buildImagePrompt" packages --include=*.ts`
Expected: no matches. (If any remain outside the files in this task, STOP and report — it means another consumer needs updating.)

- [ ] **Step 10: Commit**

```bash
git add packages/backend/src/content-generation/generation-prompts.ts packages/backend/tests/content-generation/generation-prompts.test.ts packages/backend/src/content-generation/derive-tasks.ts packages/backend/tests/content-generation/derive-tasks.test.ts
git commit -m "feat(content-studio): render generation prompts from editable templates"
```

---

## Task 3: enqueue + factory pass per-project prompts

**Files:**
- Modify: `packages/backend/src/content-generation/generation-service.ts`
- Modify: `packages/backend/src/content-generation/factory.ts`
- Test: `packages/backend/tests/content-generation/generation-service.test.ts`

- [ ] **Step 1: Update the service test deps + add an assertion**

In `packages/backend/tests/content-generation/generation-service.test.ts`:
- In `makeDeps`, add a default dep next to `getGenerationProfiles: vi.fn(() => ({})),`:
  ```ts
      getGenerationPrompts: vi.fn(() => ({})),
  ```
- Add a test at the end of the `describe('GenerationService.enqueue with generation profiles', …)` block:
  ```ts
  it('applies a per-project image prompt template to the image task', () => {
    const { deps, tasks } = makeDeps({
      getGenerationProfiles: vi.fn(() => ({ image: 'codex-image' })),
      getGenerationPrompts: vi.fn(() => ({ image: 'Make {{subject}}' })),
    })
    new GenerationService(deps as never).enqueue('c1')
    expect(tasks().find((t) => t.type === 'image')!.inputPrompt).toBe('Make s')
  })
  ```
  (The `makeDeps` refined fixture has `visualBrief.subject = 's'`.)

- [ ] **Step 2: Run the service test to verify it fails**

Run: `pnpm vitest run packages/backend/tests/content-generation/generation-service.test.ts`
Expected: FAIL — `enqueue` doesn't read `getGenerationPrompts`, and the dep is unused/undefined.

- [ ] **Step 3: Update GenerationService**

In `packages/backend/src/content-generation/generation-service.ts`:

Change the shared import to add `GenerationPromptConfig`:
```ts
import type {
  ContentLesson, ContentPipeline, DraftOutput, GenerationProfileConfig, GenerationPromptConfig, GenerationTask, LessonType,
} from '@anubis/shared'
```
In `GenerationDeps`, add after the `getGenerationProfiles` line:
```ts
  /** Resolve the per-project image/video generation prompt templates. */
  getGenerationPrompts: (projectId: string) => GenerationPromptConfig
```
In `enqueue`, after the `manual` computation, read prompts and pass them to `deriveTasks`:
```ts
    const gp = this.deps.getGenerationProfiles(item.projectId)
    const manual = {
      image: (gp.image ?? MANUAL_PROFILE_ID) === MANUAL_PROFILE_ID,
      video: (gp.video ?? MANUAL_PROFILE_ID) === MANUAL_PROFILE_ID,
    }
    const prompts = this.deps.getGenerationPrompts(item.projectId)
    const specs = deriveTasks(pipeline.refinedContent, mediaKind, manual, prompts)
```

- [ ] **Step 4: Wire the factory**

In `packages/backend/src/content-generation/factory.ts`, add to the `deps` object, next to `getGenerationProfiles: effectiveProfiles,`:
```ts
    getGenerationPrompts: (projectId) => stack.contentPipelineSettings.get(projectId).generationPrompts ?? {},
```

- [ ] **Step 5: Run the service test to verify it passes**

Run: `pnpm vitest run packages/backend/tests/content-generation/generation-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/content-generation/generation-service.ts packages/backend/src/content-generation/factory.ts packages/backend/tests/content-generation/generation-service.test.ts
git commit -m "feat(content-studio): enqueue applies per-project generation prompts"
```

---

## Task 4: Route + API client

**Files:**
- Modify: `packages/backend/src/pipeline-settings.ts`
- Test: `packages/backend/tests/pipeline-settings.test.ts`
- Modify: `packages/frontend/src/api.ts`

- [ ] **Step 1: Update the route test**

In `packages/backend/tests/pipeline-settings.test.ts`, add a test inside the existing `describe('/pipeline-settings route', …)` block:
```ts
  it('persists generationPrompts and GET returns generationDefaults', async () => {
    const { default: app } = await import('../src/app.js')
    const put = await app.request('/pipeline-settings?projectId=p2', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ steps: {}, generationProfiles: {}, generationPrompts: { image: 'IMG {{concept}}' } }),
    })
    expect(put.status).toBe(200)

    const get = await app.request('/pipeline-settings?projectId=p2')
    const body = (await get.json()) as {
      settings: { generationPrompts?: { image?: string } }
      generationDefaults: { image: string; video: string }
    }
    expect(body.settings.generationPrompts).toEqual({ image: 'IMG {{concept}}' })
    expect(typeof body.generationDefaults.image).toBe('string')
    expect(body.generationDefaults.image.length).toBeGreaterThan(0)
  })
```

- [ ] **Step 2: Run the route test to verify it fails**

Run: `pnpm vitest run packages/backend/tests/pipeline-settings.test.ts`
Expected: FAIL — `.strict()` rejects `generationPrompts` (400), and GET has no `generationDefaults`.

- [ ] **Step 3: Update the route**

In `packages/backend/src/pipeline-settings.ts`:

Add an import for the defaults:
```ts
import { DEFAULT_GENERATION_TEMPLATES } from './content-generation/generation-prompts.js'
```
Add a prompts schema after `GenerationProfilesSchema`:
```ts
const GenerationPromptsSchema = z.object({
  image: z.string().optional(),
  video: z.string().optional(),
}).strict()
```
Extend `SettingsBody`:
```ts
const SettingsBody = z.object({
  steps: z.object({
    brief: StepSettingsSchema.optional(),
    refine: StepSettingsSchema.optional(),
    ai_review: StepSettingsSchema.optional(),
  }),
  generationProfiles: GenerationProfilesSchema.optional(),
  generationPrompts: GenerationPromptsSchema.optional(),
}).strict()
```
In the GET handler, add `generationDefaults` to the response:
```ts
  return c.json({
    ok: true,
    settings: getStack().contentPipelineSettings.get(projectId),
    defaults: DEFAULT_PROMPT_TEMPLATES,
    generationDefaults: DEFAULT_GENERATION_TEMPLATES,
  })
```
In the PUT handler, pass prompts to `put`:
```ts
  return c.json({ ok: true, settings: getStack().contentPipelineSettings.put(projectId, body.steps, body.generationProfiles ?? {}, body.generationPrompts ?? {}) })
```

- [ ] **Step 4: Run the route test to verify it passes**

Run: `pnpm vitest run packages/backend/tests/pipeline-settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the API client**

In `packages/frontend/src/api.ts`:
- Add `type GenerationPromptConfig,` and `type GenerationPromptDefaults,` to the `@anubis/shared` import block.
- Replace `getPipelineSettings`:
  ```ts
  export async function getPipelineSettings(
    projectId?: string,
  ): Promise<{ settings: PipelineSettings; defaults: PipelinePromptDefaults; generationDefaults: GenerationPromptDefaults }> {
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
    const r = await api<{ ok: true; settings: PipelineSettings; defaults: PipelinePromptDefaults; generationDefaults: GenerationPromptDefaults }>(
      `/pipeline-settings${qs}`,
    )
    return { settings: r.settings, defaults: r.defaults, generationDefaults: r.generationDefaults }
  }
  ```
  (Match the existing `api(...)` call style in the current function — keep the same request mechanics, only add `generationDefaults` to the types and returned object.)
- Replace `updatePipelineSettings`:
  ```ts
  export async function updatePipelineSettings(
    projectId: string,
    steps: PipelineSettings['steps'],
    generationProfiles?: GenerationProfileConfig,
    generationPrompts?: GenerationPromptConfig,
  ): Promise<PipelineSettings> {
    const r = await api<{ ok: true; settings: PipelineSettings }>(
      `/pipeline-settings?projectId=${encodeURIComponent(projectId)}`,
      { method: 'PUT', body: JSON.stringify({ steps, generationProfiles: generationProfiles ?? {}, generationPrompts: generationPrompts ?? {} }) },
    )
    return r.settings
  }
  ```

- [ ] **Step 6: Typecheck backend + frontend**

Run: `pnpm --filter @anubis/backend exec tsc --noEmit && pnpm --filter @anubis/frontend exec tsc --noEmit`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/pipeline-settings.ts packages/backend/tests/pipeline-settings.test.ts packages/frontend/src/api.ts
git commit -m "feat(content-studio): pipeline-settings route + client carry generation prompts"
```

---

## Task 5: Frontend — Image/Video tabs

**Files:**
- Modify: `packages/frontend/src/pages/content-studio/generation-profile-picker.tsx`
- Create: `packages/frontend/src/pages/content-studio/media-generation-tab.tsx`
- Modify: `packages/frontend/src/pages/content-studio/pipeline-settings-dialog.tsx`
- Test: `packages/frontend/tests/pages/pipeline-settings-dialog.test.tsx`

- [ ] **Step 1: Add a single-media picker (refactor, keep the dual picker)**

In `packages/frontend/src/pages/content-studio/generation-profile-picker.tsx`, export a single-media picker and have the existing dual `GenerationProfilePicker` compose it. Replace the component body (from the `agentProfiles`/`imageProfiles` memos through the return) with:
```tsx
export function MediaProfilePicker({ media, profiles, value, onChange }: {
  media: 'image' | 'video'
  profiles: ProfileSummary[]
  value: string | undefined
  onChange: (id: string) => void
}) {
  const agentProfiles = useMemo(
    () => profiles.filter((p) => p.config.agent !== 'gpt-web' && p.config.agent !== 'qwen-web'),
    [profiles],
  )
  const list = useMemo(
    () => (media === 'image' ? [MANUAL_OPTION, FLOW_OPTION, ...agentProfiles] : [MANUAL_OPTION, ...agentProfiles]),
    [agentProfiles, media],
  )
  return <ProfilePicker profiles={list} value={resolveProfile(list, value)} onChange={(p) => onChange(p.id)} />
}

export function GenerationProfilePicker({ profiles, generationProfiles, onChange }: GenerationProfilePickerProps) {
  return (
    <div className='flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border/60 bg-card/50 px-3 py-2'>
      <span className='flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground'>
        Generation AI Profiles
      </span>
      <div className='flex items-center gap-2'>
        <span className='flex items-center gap-1 text-[11.5px] text-muted-foreground'><ImageIcon className='size-3.5' /> Image</span>
        <MediaProfilePicker media='image' profiles={profiles} value={generationProfiles.image} onChange={(id) => onChange({ ...generationProfiles, image: id })} />
      </div>
      <div className='flex items-center gap-2'>
        <span className='flex items-center gap-1 text-[11.5px] text-muted-foreground'><VideoIcon className='size-3.5' /> Video</span>
        <MediaProfilePicker media='video' profiles={profiles} value={generationProfiles.video} onChange={(id) => onChange({ ...generationProfiles, video: id })} />
      </div>
    </div>
  )
}
```
(Keep the existing imports — `useMemo`, `ImageIcon`, `VideoIcon`, `ProfilePicker`, the `GenerationProfileConfig`/`ProfileSummary` types — and the `MANUAL_PROFILE_ID`/`MANUAL_OPTION`/`FLOW_IMAGE_PROFILE_ID`/`FLOW_OPTION`/`resolveProfile` definitions, and `GenerationProfilePickerProps`. Only the component bodies change.)

- [ ] **Step 2: Verify the existing picker tests still pass**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/components/generation-profile-picker.test.tsx`
Expected: PASS (the dual picker's DOM/behavior is unchanged).

- [ ] **Step 3: Create the media tab component**

Create `packages/frontend/src/pages/content-studio/media-generation-tab.tsx`:
```tsx
import { RotateCcw, FileDown } from 'lucide-react'
import type { ProfileSummary } from '@anubis/shared'
import { MediaProfilePicker } from './generation-profile-picker'

const PLACEHOLDERS: Record<'image' | 'video', string> = {
  image: '{{concept}} · {{subject}} · {{style}} · {{mood}} · {{keyElements}} · {{slide}}',
  video: '{{videoScript}} · {{concept}}',
}

export function MediaGenerationTab({
  media, profiles, profileValue, onProfileChange, prompt, onPromptChange, defaultPrompt,
}: {
  media: 'image' | 'video'
  profiles: ProfileSummary[]
  profileValue: string | undefined
  onProfileChange: (id: string) => void
  prompt: string | undefined
  onPromptChange: (value: string | undefined) => void
  defaultPrompt: string
}) {
  const usingDefault = !prompt?.trim()
  return (
    <div className='space-y-4'>
      <div>
        <span className='mb-1 block text-[12px] font-medium text-muted-foreground'>Generation profile</span>
        <MediaProfilePicker media={media} profiles={profiles} value={profileValue} onChange={onProfileChange} />
        <p className='mt-1 text-[11px] text-muted-foreground'>Manual = prompt only (you generate it). Per-project override; unset inherits the global picker.</p>
      </div>
      <div>
        <div className='mb-1 flex items-center justify-between'>
          <span className='text-[12px] font-medium text-muted-foreground'>
            Generation prompt {usingDefault ? <span className='text-[11px]'>· using default</span> : <span className='text-[11px] text-[var(--anubis-gold)]'>· customized</span>}
          </span>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={() => onPromptChange(defaultPrompt)}
              className='inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground'
              title='Load the default template into the editor so you can tweak it'
            >
              <FileDown className='size-3' /> Edit from default
            </button>
            <button
              type='button'
              onClick={() => onPromptChange(undefined)}
              disabled={usingDefault}
              className='inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40'
              title='Discard the override and use the shipped default'
            >
              <RotateCcw className='size-3' /> Reset to default
            </button>
          </div>
        </div>
        <textarea
          value={prompt ?? ''}
          onChange={(e) => onPromptChange(e.target.value)}
          rows={10}
          placeholder={defaultPrompt || '(loading default…)'}
          className='w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-[var(--anubis-gold)]/60'
        />
        <p className='mt-1 text-[11px] text-muted-foreground'>
          Placeholders: <span className='font-mono'>{PLACEHOLDERS[media]}</span>. Leave blank to use the default shown above.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Update the dialog test**

In `packages/frontend/tests/pages/pipeline-settings-dialog.test.tsx`, replace the test body so it exercises the Image tab + generation prompt (keep the `vi.hoisted` mock pattern already in the file). Replace the whole `describe(...)` with:
```tsx
describe('<PipelineSettingsDialog> media generation', () => {
  it('shows Image/Video tabs and saves the generation profile + prompt', async () => {
    mocks.getPipelineSettings.mockResolvedValue({
      settings: { projectId: 'p1', steps: {}, generationProfiles: { image: 'google-flow' }, generationPrompts: {}, updatedAt: 1 },
      defaults: { brief: 'B', refine: 'R', ai_review: 'A' },
      generationDefaults: { image: 'IMG {{concept}}', video: 'VID {{videoScript}}' },
    })
    render(<PipelineSettingsDialog open projectId='p1' profiles={PROFILES as never} onClose={() => {}} />)

    // Switch to the Image tab
    await userEvent.click(await screen.findByRole('button', { name: 'Image' }))
    // The loaded image profile shows in the picker
    expect(await screen.findByText('Google Flow (browser)')).toBeInTheDocument()
    // Type a custom generation prompt. NOTE: avoid `{`/`}` here — user-event's
    // type() treats `{{` as an escape. Placeholder rendering is covered by the
    // backend unit tests; here we only verify the typed prompt is saved.
    const textarea = screen.getByPlaceholderText('IMG {{concept}}')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'Make it pop')

    await userEvent.click(screen.getByText('Save'))
    expect(mocks.updatePipelineSettings).toHaveBeenCalledWith('p1', {}, { image: 'google-flow' }, { image: 'Make it pop' })
  })
})
```
Ensure the `vi.hoisted`/`vi.mock('@/api', …)` block at the top of the file exposes `getPipelineSettings` and `updatePipelineSettings` as `mocks.*` (it already does from the prior task; if the local names differ, keep the file's existing convention and adjust the references accordingly). The `PROFILES` fixture already exists in the file.

- [ ] **Step 5: Run the dialog test to verify it fails**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/pages/pipeline-settings-dialog.test.tsx`
Expected: FAIL — there is no "Image" tab yet.

- [ ] **Step 6: Wire the tabs into the dialog**

In `packages/frontend/src/pages/content-studio/pipeline-settings-dialog.tsx`:

Update imports:
```ts
import type { GenerationProfileConfig, GenerationPromptConfig, GenerationPromptDefaults, PipelineAiStep, PipelinePromptDefaults, PipelineStepSettings, ProfileSummary, ReasoningEffort } from '@anubis/shared'
import { MediaGenerationTab } from './media-generation-tab'
```
(Remove the `import { GenerationProfilePicker } from './generation-profile-picker'` line — the dialog no longer renders the dual picker.)

Add a media type + a combined tab type and tab list:
```ts
type MediaType = 'image' | 'video'
type TabKey = PipelineAiStep | MediaType

const MEDIA_TABS: { key: MediaType; label: string }[] = [
  { key: 'image', label: 'Image' },
  { key: 'video', label: 'Video' },
]
```

Change the `active` state type and add the new state:
```ts
  const [genPrompts, setGenPrompts] = useState<GenerationPromptConfig>({})
  const [genDefaults, setGenDefaults] = useState<GenerationPromptDefaults | null>(null)
  const [active, setActive] = useState<TabKey>('brief')
```
In the load effect's `.then`, set the new state:
```ts
    void getPipelineSettings(projectId).then(({ settings, defaults: d, generationDefaults }) => {
      if (cancelled) return
      setSteps(settings.steps ?? {})
      setGenProfiles(settings.generationProfiles ?? {})
      setGenPrompts(settings.generationPrompts ?? {})
      setDefaults(d)
      setGenDefaults(generationDefaults)
    })
```
Change `save()` to send prompts too:
```ts
  async function save() {
    setBusy(true)
    try {
      await updatePipelineSettings(projectId, clean(steps), genProfiles, genPrompts)
      onClose()
    } finally {
      setBusy(false)
    }
  }
```
Guard the AI-step-only derived values so they don't run for media tabs. Replace the lines:
```ts
  const cur = steps[active] ?? {}
  function patch(p: Partial<PipelineStepSettings>) {
    setSteps((s) => ({ ...s, [active]: { ...s[active], ...p } }))
  }
  ...
  const tab = STEP_TABS.find((t) => t.key === active)!
  const usingDefault = !cur.promptTemplate?.trim()
```
with:
```ts
  const isMedia = active === 'image' || active === 'video'
  const stepKey = (isMedia ? 'brief' : active) as PipelineAiStep
  const cur = steps[stepKey] ?? {}
  function patch(p: Partial<PipelineStepSettings>) {
    setSteps((s) => ({ ...s, [stepKey]: { ...s[stepKey], ...p } }))
  }
  const tab = STEP_TABS.find((t) => t.key === stepKey)!
  const usingDefault = !cur.promptTemplate?.trim()
```
Render all five tabs — change the tab strip's `.map` source from `STEP_TABS` to `[...STEP_TABS, ...MEDIA_TABS]`:
```tsx
        <div className='flex gap-1 border-b border-border'>
          {[...STEP_TABS, ...MEDIA_TABS].map((t) => (
            <button
              key={t.key}
              type='button'
              onClick={() => setActive(t.key)}
              className={cn(
                'px-3 py-1.5 text-[12.5px] font-medium border-b-2 -mb-px',
                active === t.key
                  ? 'border-[var(--anubis-gold)] text-[var(--anubis-gold)]'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
```
Replace the scroll container's contents so media tabs render `MediaGenerationTab` and AI tabs render the existing body. The scroll container currently holds the Prompt template block, the Parameters grid, and the Media generation block. Replace the entire `<div className='max-h-[58vh] space-y-4 overflow-y-auto pr-1'> … </div>` with:
```tsx
        <div className='max-h-[58vh] space-y-4 overflow-y-auto pr-1'>
          {isMedia ? (
            <MediaGenerationTab
              media={active as MediaType}
              profiles={profiles}
              profileValue={genProfiles[active as MediaType]}
              onProfileChange={(id) => setGenProfiles({ ...genProfiles, [active]: id })}
              prompt={genPrompts[active as MediaType]}
              onPromptChange={(v) => setGenPrompts({ ...genPrompts, [active]: v })}
              defaultPrompt={genDefaults ? genDefaults[active as MediaType] : ''}
            />
          ) : (
            <>
              {/* Prompt template */}
              <div>
                <div className='mb-1 flex items-center justify-between'>
                  <span className='text-[12px] font-medium text-muted-foreground'>
                    Prompt template {usingDefault ? <span className='text-[11px]'>· using default</span> : <span className='text-[11px] text-[var(--anubis-gold)]'>· customized</span>}
                  </span>
                  <div className='flex items-center gap-2'>
                    <button
                      type='button'
                      onClick={() => defaults && patch({ promptTemplate: defaults[stepKey] })}
                      className='inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground'
                      title='Load the default template into the editor so you can tweak it'
                    >
                      <FileDown className='size-3' /> Edit from default
                    </button>
                    <button
                      type='button'
                      onClick={() => patch({ promptTemplate: undefined })}
                      disabled={usingDefault}
                      className='inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40'
                      title='Discard the override and use the shipped default'
                    >
                      <RotateCcw className='size-3' /> Reset to default
                    </button>
                  </div>
                </div>
                <textarea
                  value={cur.promptTemplate ?? ''}
                  onChange={(e) => patch({ promptTemplate: e.target.value })}
                  rows={12}
                  placeholder={defaults ? defaults[stepKey] : '(loading default…)'}
                  className='w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-[var(--anubis-gold)]/60'
                />
                <p className='mt-1 text-[11px] text-muted-foreground'>
                  Placeholders: <span className='font-mono'>{tab.placeholders}</span>. Leave blank to use the default shown above.
                </p>
              </div>

              {/* Parameters */}
              <div className='grid grid-cols-2 gap-3'>
                <label className='block'>
                  <span className='mb-1 block text-[12px] font-medium text-muted-foreground'>Model</span>
                  <input
                    type='text'
                    value={cur.model ?? ''}
                    onChange={(e) => patch({ model: e.target.value })}
                    placeholder='(profile default)'
                    className='h-8 w-full rounded-md border border-border bg-background px-2 text-[12.5px] outline-none focus:border-[var(--anubis-gold)]/60'
                  />
                </label>
                <label className='block'>
                  <span className='mb-1 block text-[12px] font-medium text-muted-foreground'>Reasoning effort</span>
                  <select
                    value={cur.reasoningEffort ?? ''}
                    onChange={(e) => patch({ reasoningEffort: (e.target.value || undefined) as ReasoningEffort | undefined })}
                    className='h-8 w-full rounded-md border border-border bg-background px-2 text-[12.5px] outline-none focus:border-[var(--anubis-gold)]/60'
                  >
                    <option value=''>(profile default)</option>
                    {EFFORTS.map((eff) => <option key={eff} value={eff}>{eff}</option>)}
                  </select>
                </label>
                <label className='block'>
                  <span className='mb-1 block text-[12px] font-medium text-muted-foreground'>Temperature</span>
                  <input
                    type='number'
                    min={0}
                    max={2}
                    step={0.1}
                    value={cur.temperature ?? ''}
                    onChange={(e) => patch({ temperature: e.target.value === '' ? undefined : Number(e.target.value) })}
                    placeholder='(default)'
                    className='h-8 w-full rounded-md border border-border bg-background px-2 text-[12.5px] outline-none focus:border-[var(--anubis-gold)]/60'
                  />
                  <span className='mt-0.5 block text-[10.5px] text-muted-foreground'>Best-effort — only agents that support sampling apply it.</span>
                </label>
                <label className='block'>
                  <span className='mb-1 block text-[12px] font-medium text-muted-foreground'>JSON repair attempts</span>
                  <input
                    type='number'
                    min={1}
                    max={6}
                    step={1}
                    value={cur.maxJsonAttempts ?? ''}
                    onChange={(e) => patch({ maxJsonAttempts: e.target.value === '' ? undefined : Number(e.target.value) })}
                    placeholder='3'
                    className='h-8 w-full rounded-md border border-border bg-background px-2 text-[12.5px] outline-none focus:border-[var(--anubis-gold)]/60'
                  />
                  <span className='mt-0.5 block text-[10.5px] text-muted-foreground'>Auto-retries when the agent returns malformed/truncated JSON.</span>
                </label>
              </div>
            </>
          )}
        </div>
```
(The old bottom "Media generation" block is now gone — it's replaced by the Image/Video tabs.)

- [ ] **Step 7: Run the dialog test to verify it passes**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/pages/pipeline-settings-dialog.test.tsx`
Expected: PASS.

- [ ] **Step 8: Typecheck the frontend**

Run: `pnpm --filter @anubis/frontend exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/frontend/src/pages/content-studio/generation-profile-picker.tsx packages/frontend/src/pages/content-studio/media-generation-tab.tsx packages/frontend/src/pages/content-studio/pipeline-settings-dialog.tsx packages/frontend/tests/pages/pipeline-settings-dialog.test.tsx
git commit -m "feat(content-studio): Image/Video generation tabs in Pipeline Settings"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Rebuild changed workspace packages**

Run: `pnpm --filter @anubis/shared build && pnpm --filter @anubis/conversation build`
Expected: both succeed.

- [ ] **Step 2: Typecheck the monorepo**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Run the backend + conversation suites**

Run: `pnpm vitest run packages/backend/tests/content-generation/ packages/backend/tests/pipeline-settings.test.ts packages/conversation/tests/db/content-pipeline-settings-repo.test.ts`
Expected: PASS.

- [ ] **Step 4: Run the frontend Content Studio suites**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/components/generation-profile-picker.test.tsx tests/pages/pipeline-settings-dialog.test.tsx tests/pages/generation-sections.test.tsx`
Expected: PASS.

- [ ] **Step 5: Sanity-check end-to-end (reasoning, no code)**

Confirm by reading the changed files:
- A per-project image template set in the Image tab → saved via `updatePipelineSettings` → persisted in `generation_prompts` → `enqueue` reads it via `getGenerationPrompts` → `deriveTasks` renders it into the image task `inputPrompt` (shown in Manual mode + fed to the auto agent).
- Unset template → `deriveTasks` uses `DEFAULT_GENERATION_TEMPLATES`.
- Image/Video are tabs; the bottom "Media generation" block is gone; the page-level global `GenerationProfilePicker` still works.

- [ ] **Step 6: Confirm clean tree**

```bash
git status --short
```
Expected: clean (all tasks committed).
