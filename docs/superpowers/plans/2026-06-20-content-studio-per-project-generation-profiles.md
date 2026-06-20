# Content Studio — Per-Project Generation Profiles + Manual-by-Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Content Studio generation profiles (image/video) overridable per-project in Pipeline Settings, layered over the global page picker, with Manual (prompt-only) as the new built-in default for both image and video.

**Architecture:** Add a `generation_profiles` column to `content_pipeline_settings`, expose it through the repo/route/`PipelineSettings`. Introduce one resolver `effectiveProfiles(projectId) = projectOverride ?? global ?? undefined` that BOTH `enqueue` (manual gate, defaulting unset → `manual`) and the image/video generators (profile/tool selection) consume, so per-project picks are honored everywhere. Add a Media-generation section to the Pipeline Settings dialog.

**Tech Stack:** TypeScript (ESM), better-sqlite3, Hono, React 19 + Vite, Vitest + @testing-library/react.

**Spec:** [docs/superpowers/specs/2026-06-20-content-studio-per-project-generation-profiles-design.md](../specs/2026-06-20-content-studio-per-project-generation-profiles-design.md)

**Builds on:** [2026-06-20-content-studio-manual-media-generation.md](2026-06-20-content-studio-manual-media-generation.md) (the `MANUAL_PROFILE_ID` constant + prompt-only tasks already merged).

---

## Cross-package build note (read once)

Vitest resolves `@anubis/*` imports to each package's **dist**, not source (see project memory). Two consequences this plan handles explicitly:
- After editing `packages/shared/src/index.ts`, rebuild it (`pnpm --filter @anubis/shared build`) so downstream **typecheck** sees the new field.
- The backend route test (Task 2) exercises `@anubis/conversation` via dist, so rebuild conversation (`pnpm --filter @anubis/conversation build`) after Task 1's repo+migration change.

The repo unit test (Task 1) imports conversation **source** directly, so it needs no build.

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `packages/conversation/src/db/migrations/034_content_pipeline_settings_generation.sql` | add `generation_profiles` column | Create |
| `packages/conversation/src/db/migrations/index.ts` | register migration 034 | Modify |
| `packages/shared/src/index.ts` | `PipelineSettings.generationProfiles` | Modify |
| `packages/conversation/src/db/repositories/content-pipeline-settings-repo.ts` | read/write the column | Modify |
| `packages/conversation/tests/db/content-pipeline-settings-repo.test.ts` | repo round-trip | Modify |
| `packages/backend/src/pipeline-settings.ts` | route body + put call | Modify |
| `packages/backend/tests/pipeline-settings.test.ts` | route round-trip | Create |
| `packages/backend/src/content-generation/agent-generators.ts` | generators read effective profiles | Modify |
| `packages/backend/tests/content-generation/agent-generators.test.ts` | generator deps | Modify |
| `packages/backend/src/content-generation/generation-service.ts` | `getGenerationProfiles` dep + default-manual | Modify |
| `packages/backend/tests/content-generation/generation-service.test.ts` | enqueue default/override | Modify |
| `packages/backend/src/content-generation/factory.ts` | `effectiveProfiles` resolver + wiring | Modify |
| `packages/frontend/src/api.ts` | `updatePipelineSettings` signature | Modify |
| `packages/frontend/src/pages/content-studio/pipeline-settings-dialog.tsx` | Media generation section | Modify |
| `packages/frontend/tests/pages/pipeline-settings-dialog.test.tsx` | dialog renders + saves profiles | Create |
| `packages/frontend/src/pages/content-studio.tsx` | pass `profiles` to dialog | Modify |
| `packages/frontend/src/pages/content-studio/generation-profile-picker.tsx` | Manual default display | Modify |
| `packages/frontend/tests/components/generation-profile-picker.test.tsx` | Manual-when-unset + robust menu click | Modify |

---

## Task 1: Storage — migration, type, repo

**Files:**
- Create: `packages/conversation/src/db/migrations/034_content_pipeline_settings_generation.sql`
- Modify: `packages/conversation/src/db/migrations/index.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/conversation/src/db/repositories/content-pipeline-settings-repo.ts`
- Test: `packages/conversation/tests/db/content-pipeline-settings-repo.test.ts`

- [ ] **Step 1: Update the failing tests**

In `packages/conversation/tests/db/content-pipeline-settings-repo.test.ts`, update the empty-settings expectation and add a round-trip test.

Replace:
```ts
  it('returns empty settings for an unknown project', () => {
    const repo = new ContentPipelineSettingsRepo(openMigratedDb())
    expect(repo.get('p1')).toEqual({ projectId: 'p1', steps: {}, updatedAt: 0 })
  })
```
with:
```ts
  it('returns empty settings for an unknown project', () => {
    const repo = new ContentPipelineSettingsRepo(openMigratedDb())
    expect(repo.get('p1')).toEqual({ projectId: 'p1', steps: {}, generationProfiles: {}, updatedAt: 0 })
  })

  it('persists and round-trips generation profiles', () => {
    const repo = new ContentPipelineSettingsRepo(openMigratedDb())
    repo.put('p1', {}, { image: 'manual', video: 'codex-video' })
    expect(repo.get('p1').generationProfiles).toEqual({ image: 'manual', video: 'codex-video' })
  })

  it('keeps steps and generation profiles independent on put', () => {
    const repo = new ContentPipelineSettingsRepo(openMigratedDb())
    repo.put('p1', { brief: { model: 'a' } }, { image: 'manual' })
    const s = repo.get('p1')
    expect(s.steps.brief).toMatchObject({ model: 'a' })
    expect(s.generationProfiles).toEqual({ image: 'manual' })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/conversation/tests/db/content-pipeline-settings-repo.test.ts`
Expected: FAIL — `get` returns no `generationProfiles` key and `put` rejects a third argument / the `generation_profiles` column doesn't exist.

- [ ] **Step 3: Create the migration**

Create `packages/conversation/src/db/migrations/034_content_pipeline_settings_generation.sql`:

```sql
-- Per-project Content Studio generation-profile overrides (image / video),
-- stored as a JSON blob alongside the per-step settings.
ALTER TABLE content_pipeline_settings
  ADD COLUMN generation_profiles TEXT NOT NULL DEFAULT '{}';
```

- [ ] **Step 4: Register the migration**

In `packages/conversation/src/db/migrations/index.ts`, add after the `load(33, …)` line inside `MIGRATIONS`:

```ts
  load(34, '034_content_pipeline_settings_generation.sql'),
```

- [ ] **Step 5: Extend the shared type**

In `packages/shared/src/index.ts`, change `PipelineSettings`:

```ts
/** Per-project Content Studio pipeline settings (prompts + parameters per step). */
export interface PipelineSettings {
  projectId: string
  steps: Partial<Record<PipelineAiStep, PipelineStepSettings>>
  /** Per-project generation-profile overrides (image / video). */
  generationProfiles?: GenerationProfileConfig
  updatedAt: number
}
```

- [ ] **Step 6: Update the repo**

Replace the entire body of `packages/conversation/src/db/repositories/content-pipeline-settings-repo.ts` with:

```ts
import type { GenerationProfileConfig, PipelineAiStep, PipelineSettings, PipelineStepSettings } from '@anubis/shared'
import type { Db } from '../client.js'

interface Row {
  project_id: string
  steps: string | null
  generation_profiles: string | null
  updated_at: number
}

type Steps = PipelineSettings['steps']

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as T) : fallback
  } catch {
    return fallback
  }
}

/**
 * Per-project Content Studio pipeline settings — per-step prompt/parameter
 * overrides plus image/video generation-profile overrides. One row per project;
 * absent rows default to "no overrides".
 */
export class ContentPipelineSettingsRepo {
  constructor(private readonly db: Db) {}

  get(projectId: string): PipelineSettings {
    const row = this.db
      .prepare('SELECT * FROM content_pipeline_settings WHERE project_id = ?')
      .get(projectId) as Row | undefined
    if (!row) return { projectId, steps: {}, generationProfiles: {}, updatedAt: 0 }
    return {
      projectId,
      steps: parseJson<Steps>(row.steps, {}),
      generationProfiles: parseJson<GenerationProfileConfig>(row.generation_profiles, {}),
      updatedAt: row.updated_at,
    }
  }

  /** Replace the per-step overrides and generation profiles for a project. */
  put(projectId: string, steps: Steps, generationProfiles: GenerationProfileConfig = {}): PipelineSettings {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO content_pipeline_settings (project_id, steps, generation_profiles, updated_at)
      VALUES (@projectId, @steps, @generationProfiles, @updatedAt)
      ON CONFLICT(project_id) DO UPDATE SET
        steps = @steps, generation_profiles = @generationProfiles, updated_at = @updatedAt
    `).run({
      projectId,
      steps: JSON.stringify(steps ?? {}),
      generationProfiles: JSON.stringify(generationProfiles ?? {}),
      updatedAt: now,
    })
    return { projectId, steps: steps ?? {}, generationProfiles: generationProfiles ?? {}, updatedAt: now }
  }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run packages/conversation/tests/db/content-pipeline-settings-repo.test.ts`
Expected: PASS — all repo tests green (existing step tests still pass because `put`'s first two params are unchanged).

- [ ] **Step 8: Rebuild shared + conversation (so downstream typecheck/tests see the changes)**

Run: `pnpm --filter @anubis/shared build && pnpm --filter @anubis/conversation build`
Expected: both builds succeed.

- [ ] **Step 9: Commit**

```bash
git add packages/conversation/src/db/migrations/034_content_pipeline_settings_generation.sql packages/conversation/src/db/migrations/index.ts packages/shared/src/index.ts packages/conversation/src/db/repositories/content-pipeline-settings-repo.ts packages/conversation/tests/db/content-pipeline-settings-repo.test.ts
git commit -m "feat(content-studio): store per-project generation profiles"
```

---

## Task 2: Route — accept + persist generationProfiles

**Files:**
- Modify: `packages/backend/src/pipeline-settings.ts`
- Test: `packages/backend/tests/pipeline-settings.test.ts` (create)

- [ ] **Step 1: Write the failing route test**

Create `packages/backend/tests/pipeline-settings.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dataDir: string

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'anubis-pipeline-settings-'))
  process.env.ANUBIS_DATA_DIR = dataDir
})

afterAll(async () => {
  const { shutdownStack } = await import('../src/services.js')
  await shutdownStack()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('/pipeline-settings route', () => {
  it('PUT persists generationProfiles; GET returns them', async () => {
    const { default: app } = await import('../src/app.js')
    const put = await app.request('/pipeline-settings?projectId=p1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ steps: {}, generationProfiles: { image: 'manual', video: 'codex-video' } }),
    })
    expect(put.status).toBe(200)

    const get = await app.request('/pipeline-settings?projectId=p1')
    const body = (await get.json()) as { settings: { generationProfiles?: { image?: string; video?: string } } }
    expect(body.settings.generationProfiles).toEqual({ image: 'manual', video: 'codex-video' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/backend/tests/pipeline-settings.test.ts`
Expected: FAIL — `SettingsBody` is `.strict()` so `generationProfiles` is rejected (400), and `put` is never given the profiles.

- [ ] **Step 3: Extend the route**

In `packages/backend/src/pipeline-settings.ts`, add a profiles schema, extend the body, and pass profiles to `put`.

Add after `StepSettingsSchema`:

```ts
const GenerationProfilesSchema = z.object({
  image: z.string().optional(),
  video: z.string().optional(),
}).strict()
```

Change `SettingsBody`:

```ts
const SettingsBody = z.object({
  steps: z.object({
    brief: StepSettingsSchema.optional(),
    refine: StepSettingsSchema.optional(),
    ai_review: StepSettingsSchema.optional(),
  }),
  generationProfiles: GenerationProfilesSchema.optional(),
}).strict()
```

Change the PUT handler's final line:

```ts
  return c.json({ ok: true, settings: getStack().contentPipelineSettings.put(projectId, body.steps, body.generationProfiles ?? {}) })
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/backend/tests/pipeline-settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/pipeline-settings.ts packages/backend/tests/pipeline-settings.test.ts
git commit -m "feat(content-studio): pipeline-settings route persists generation profiles"
```

---

## Task 3: Backend resolution — generators + service + factory

**Files:**
- Modify: `packages/backend/src/content-generation/agent-generators.ts`
- Modify: `packages/backend/src/content-generation/generation-service.ts`
- Modify: `packages/backend/src/content-generation/factory.ts`
- Test: `packages/backend/tests/content-generation/agent-generators.test.ts`
- Test: `packages/backend/tests/content-generation/generation-service.test.ts`

- [ ] **Step 1: Update the generator tests (deps: getConfig → getProfiles)**

In `packages/backend/tests/content-generation/agent-generators.test.ts`:

Change the import line:
```ts
import type { GenerationTask } from '@anubis/shared'
```

Replace every generator construction. There are four:
```ts
    const gen = new ConfigurableImageGenerator({
      getProfiles: () => ({}), runAgent, flow: { generate: vi.fn() } as never,
    })
```
(applies to the three `ConfigurableImageGenerator` constructions that currently pass `getConfig: () => ({} as AppConfig)`), and for the Flow-delegation test:
```ts
    const gen = new ConfigurableImageGenerator({
      getProfiles: () => ({ image: FLOW_IMAGE_PROFILE_ID }),
      runAgent, flow: { generate: flowGenerate } as never,
    })
```
and the video generator:
```ts
    const gen = new AgentVideoGenerator({ getProfiles: () => ({}), runAgent })
```

- [ ] **Step 2: Run generator tests to verify they fail**

Run: `pnpm vitest run packages/backend/tests/content-generation/agent-generators.test.ts`
Expected: FAIL — `getProfiles` is not a known dep (type error / undefined call) until the source changes.

- [ ] **Step 3: Update the generators to read effective profiles**

In `packages/backend/src/content-generation/agent-generators.ts`:

Change the shared import:
```ts
import type { AgentKind, GenerationCapability, GenerationOutput, GenerationProfileConfig, GenerationTask } from '@anubis/shared'
```

Replace `ImageGeneratorDeps` + `ConfigurableImageGenerator`:
```ts
export interface ImageGeneratorDeps {
  /** Resolve the effective generation profiles (project override → global) for a project. */
  getProfiles: (projectId: string) => GenerationProfileConfig
  runAgent: RunAgent
  /** The Google Flow generator, used when the image profile is google-flow. */
  flow: Generator
}

/** Image capability: codex `$imagegen` agent by default; Google Flow when selected. */
export class ConfigurableImageGenerator implements Generator {
  name = 'agent-image'
  capability: GenerationCapability = 'image'
  constructor(private readonly deps: ImageGeneratorDeps) {}

  async generate(task: GenerationTask, ctx: GenerateCtx): Promise<GenerationOutput> {
    const selected = this.deps.getProfiles(ctx.projectId).image
    if (selected === FLOW_IMAGE_PROFILE_ID) {
      return this.deps.flow.generate(task, ctx)
    }
    const profileId = selected ?? 'codex-image'
    return generateViaAgent(this.deps.runAgent, profileId, imagePrompt(task.inputPrompt, ctx.assetDir), ctx, IMAGE_EXTS, 'image', `Image · ${ctx.contentId}`)
  }
}
```

Replace `VideoGeneratorDeps` + `AgentVideoGenerator`:
```ts
export interface VideoGeneratorDeps {
  /** Resolve the effective generation profiles (project override → global) for a project. */
  getProfiles: (projectId: string) => GenerationProfileConfig
  runAgent: RunAgent
}

/** Video capability: an agent driving the hyperframes npm package → MP4. */
export class AgentVideoGenerator implements Generator {
  name = 'agent-video'
  capability: GenerationCapability = 'video'
  constructor(private readonly deps: VideoGeneratorDeps) {}

  async generate(task: GenerationTask, ctx: GenerateCtx): Promise<GenerationOutput> {
    const profileId = this.deps.getProfiles(ctx.projectId).video ?? 'codex-video'
    return generateViaAgent(this.deps.runAgent, profileId, videoPrompt(task.inputPrompt, ctx.assetDir), ctx, VIDEO_EXTS, 'video', `Video · ${ctx.contentId}`)
  }
}
```

- [ ] **Step 4: Run generator tests to verify they pass**

Run: `pnpm vitest run packages/backend/tests/content-generation/agent-generators.test.ts`
Expected: PASS — defaults still resolve to `codex-image` / `codex-video`; Flow delegation still works.

- [ ] **Step 5: Update the service tests (dep rename + default-manual behavior)**

In `packages/backend/tests/content-generation/generation-service.test.ts`:

Change the default dep line:
```ts
      getGenerationProfiles: vi.fn(() => ({})),
```
(replacing the `getConfig: vi.fn(() => ({}))` line added previously).

The three `runAll` tests now need an explicit image profile so the image task is `pending` and actually runs (the default is now Manual). In each of these three tests, change `makeDeps()` to `makeDeps({ getGenerationProfiles: vi.fn(() => ({ image: 'codex-image' })) })`:
- `it('runs pending tasks, stitches draft, sets status draft', …)`
- `it('passes conversationId + onConversation to the generator and persists the id', …)`
- `it('creates a generation_failure lesson and stays generating when a task fails', …)`

Replace the whole `describe('GenerationService.enqueue with manual media', …)` block with:
```ts
describe('GenerationService.enqueue with generation profiles', () => {
  it('defaults image to manual when no profiles are configured', async () => {
    const { deps, tasks, statuses } = makeDeps()
    const svc = new GenerationService(deps as never)
    svc.enqueue('c1')
    expect(tasks().find((t) => t.type === 'image')!.status).toBe('manual')
    await svc.runAll('c1')
    expect(statuses).toContain('draft')
    expect(tasks().find((t) => t.type === 'image')!.status).toBe('manual')
  })

  it('a project override re-enables auto image generation (pending)', () => {
    const { deps, tasks } = makeDeps({ getGenerationProfiles: vi.fn(() => ({ image: 'codex-image' })) })
    new GenerationService(deps as never).enqueue('c1')
    expect(tasks().find((t) => t.type === 'image')!.status).toBe('pending')
  })
})
```

- [ ] **Step 6: Run service tests to verify they fail**

Run: `pnpm vitest run packages/backend/tests/content-generation/generation-service.test.ts`
Expected: FAIL — `enqueue` still calls `this.deps.getConfig()` (now undefined) and doesn't default to manual.

- [ ] **Step 7: Update GenerationService**

In `packages/backend/src/content-generation/generation-service.ts`:

The shared import already includes `GenerationProfileConfig` (from the previous feature). Keep it.

Replace the `getConfig` dep field in `GenerationDeps`:
```ts
  /** Resolve the effective generation profiles (project override → global) for a project. */
  getGenerationProfiles: (projectId: string) => GenerationProfileConfig
  maxRetries: number
```

Replace the profile read in `enqueue`:
```ts
    const mediaKind = pipeline.rawIdea?.mediaKind
    const gp = this.deps.getGenerationProfiles(item.projectId)
    const manual = {
      image: (gp.image ?? MANUAL_PROFILE_ID) === MANUAL_PROFILE_ID,
      video: (gp.video ?? MANUAL_PROFILE_ID) === MANUAL_PROFILE_ID,
    }
    const specs = deriveTasks(pipeline.refinedContent, mediaKind, manual)
    this.deps.taskRepo.deleteByContent(id)
```

- [ ] **Step 8: Update the factory wiring**

In `packages/backend/src/content-generation/factory.ts`:

Add the shared type import at the top:
```ts
import type { GenerationProfileConfig } from '@anubis/shared'
```

After `const runAgent: RunAgent = …`, add the resolver:
```ts
  const effectiveProfiles = (projectId: string): GenerationProfileConfig => {
    const project = stack.contentPipelineSettings.get(projectId).generationProfiles
    const global = stack.appConfig.get().generationProfiles
    return { image: project?.image ?? global?.image, video: project?.video ?? global?.video }
  }
```

Change the two agent generator constructions in the registry:
```ts
    new ConfigurableImageGenerator({ getProfiles: effectiveProfiles, runAgent, flow }),
    new AgentVideoGenerator({ getProfiles: effectiveProfiles, runAgent }),
```

In the `deps` object, replace the `getConfig,` line (added previously) with:
```ts
    getGenerationProfiles: effectiveProfiles,
```
(`const getConfig = () => stack.appConfig.get()` stays — `FlowImageGenerator` still uses it.)

- [ ] **Step 9: Run the backend generation tests to verify they pass**

Run: `pnpm vitest run packages/backend/tests/content-generation/`
Expected: PASS — all content-generation tests green.

- [ ] **Step 10: Commit**

```bash
git add packages/backend/src/content-generation/agent-generators.ts packages/backend/src/content-generation/generation-service.ts packages/backend/src/content-generation/factory.ts packages/backend/tests/content-generation/agent-generators.test.ts packages/backend/tests/content-generation/generation-service.test.ts
git commit -m "feat(content-studio): resolve generation profiles per-project, manual default"
```

---

## Task 4: Frontend — dialog section, API, picker default

**Files:**
- Modify: `packages/frontend/src/api.ts`
- Modify: `packages/frontend/src/pages/content-studio/pipeline-settings-dialog.tsx`
- Modify: `packages/frontend/src/pages/content-studio.tsx`
- Modify: `packages/frontend/src/pages/content-studio/generation-profile-picker.tsx`
- Test: `packages/frontend/tests/pages/pipeline-settings-dialog.test.tsx` (create)
- Test: `packages/frontend/tests/components/generation-profile-picker.test.tsx`

- [ ] **Step 1: Write the failing dialog test**

Create `packages/frontend/tests/pages/pipeline-settings-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const getPipelineSettings = vi.fn()
const updatePipelineSettings = vi.fn(async () => ({ projectId: 'p1', steps: {}, updatedAt: 1 }))
vi.mock('@/api', () => ({ getPipelineSettings, updatePipelineSettings }))

import { PipelineSettingsDialog } from '@/pages/content-studio/pipeline-settings-dialog'

const PROFILES = [
  { id: 'codex-coding', name: 'Codex · Coding', source: 'builtin', config: { agent: 'codex' }, sortOrder: 0, createdAt: 0, updatedAt: 0 },
]

describe('<PipelineSettingsDialog> media generation', () => {
  it('loads, displays, and saves the per-project generation profiles', async () => {
    getPipelineSettings.mockResolvedValue({
      settings: { projectId: 'p1', steps: {}, generationProfiles: { image: 'google-flow' }, updatedAt: 1 },
      defaults: { brief: 'B', refine: 'R', ai_review: 'A' },
    })
    render(<PipelineSettingsDialog open projectId='p1' profiles={PROFILES as never} onClose={() => {}} />)

    expect(await screen.findByText('Generation AI Profiles')).toBeInTheDocument()
    expect(screen.getByText('Google Flow (browser)')).toBeInTheDocument() // image picker shows loaded value

    await userEvent.click(screen.getByText('Save'))
    expect(updatePipelineSettings).toHaveBeenCalledWith('p1', {}, { image: 'google-flow' })
  })
})
```

- [ ] **Step 2: Run the dialog test to verify it fails**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/pages/pipeline-settings-dialog.test.tsx`
Expected: FAIL — the dialog has no `profiles` prop, no "Generation AI Profiles" section, and `updatePipelineSettings` is called with only two args.

- [ ] **Step 3: Update the API client**

In `packages/frontend/src/api.ts`, add `type GenerationProfileConfig,` to the `@anubis/shared` import block (before the closing `} from '@anubis/shared'` at line ~88), and replace `updatePipelineSettings`:

```ts
export async function updatePipelineSettings(
  projectId: string,
  steps: PipelineSettings['steps'],
  generationProfiles?: GenerationProfileConfig,
): Promise<PipelineSettings> {
  const r = await api<{ ok: true; settings: PipelineSettings }>(
    `/pipeline-settings?projectId=${encodeURIComponent(projectId)}`,
    { method: 'PUT', body: JSON.stringify({ steps, generationProfiles: generationProfiles ?? {} }) },
  )
  return r.settings
}
```

- [ ] **Step 4: Add the Media generation section to the dialog**

In `packages/frontend/src/pages/content-studio/pipeline-settings-dialog.tsx`:

Add imports:
```ts
import type { GenerationProfileConfig, PipelineAiStep, PipelinePromptDefaults, PipelineStepSettings, ProfileSummary, ReasoningEffort } from '@anubis/shared'
import { GenerationProfilePicker } from './generation-profile-picker'
```
(extend the existing `@anubis/shared` import to include `GenerationProfileConfig` and `ProfileSummary`.)

Add `profiles` to the props:
```ts
export function PipelineSettingsDialog({
  open,
  projectId,
  profiles,
  onClose,
}: {
  open: boolean
  projectId: string
  profiles: ProfileSummary[]
  onClose: () => void
}) {
```

Add state next to the other `useState` calls:
```ts
  const [genProfiles, setGenProfiles] = useState<GenerationProfileConfig>({})
```

In the load effect, set it from the loaded settings — change the `.then` body:
```ts
    void getPipelineSettings(projectId).then(({ settings, defaults: d }) => {
      if (cancelled) return
      setSteps(settings.steps ?? {})
      setGenProfiles(settings.generationProfiles ?? {})
      setDefaults(d)
    })
```

Change `save` to pass the profiles:
```ts
  async function save() {
    setBusy(true)
    try {
      await updatePipelineSettings(projectId, clean(steps), genProfiles)
      onClose()
    } finally {
      setBusy(false)
    }
  }
```

Add the Media generation section — insert it inside the scroll container, after the closing `</div>` of the Parameters grid and before the container's closing `</div>` (i.e., as the last child of `<div className='max-h-[58vh] …'>`):
```tsx
          {/* Media generation */}
          <div className='border-t border-border pt-3'>
            <div className='mb-1 flex items-center justify-between'>
              <span className='text-[12px] font-medium text-muted-foreground'>Media generation</span>
              <button
                type='button'
                onClick={() => setGenProfiles({})}
                className='inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground'
                title='Clear the per-project override (falls back to the global picker / Manual)'
              >
                <RotateCcw className='size-3' /> Reset to default
              </button>
            </div>
            <GenerationProfilePicker profiles={profiles} generationProfiles={genProfiles} onChange={setGenProfiles} />
            <p className='mt-1 text-[11px] text-muted-foreground'>Per-project override. Unset = global default (Manual).</p>
          </div>
```

- [ ] **Step 5: Pass `profiles` from the page**

In `packages/frontend/src/pages/content-studio.tsx`, update the dialog render (currently `<PipelineSettingsDialog open={settingsOpen} projectId={projectId} onClose={() => setSettingsOpen(false)} />`):

```tsx
      <PipelineSettingsDialog open={settingsOpen} projectId={projectId} profiles={profiles} onClose={() => setSettingsOpen(false)} />
```

- [ ] **Step 6: Run the dialog test to verify it passes**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/pages/pipeline-settings-dialog.test.tsx`
Expected: PASS.

- [ ] **Step 7: Update the picker for the Manual-when-unset default + add its test**

In `packages/frontend/src/pages/content-studio/generation-profile-picker.tsx`, change `resolveProfile` so an unset id shows the Manual option:

```ts
function resolveProfile(profiles: ProfileSummary[], id: string | undefined): ProfileSummary | null {
  if (!id) return profiles.find((p) => p.id === MANUAL_PROFILE_ID) ?? null
  return profiles.find((p) => p.id === id) ?? null
}
```

In `packages/frontend/tests/components/generation-profile-picker.test.tsx`, the trigger now also shows "Manual (I'll generate it)" when unset, so the menu click must target the menu row specifically. Replace the two existing `await userEvent.click(await screen.findByText("Manual (I'll generate it)"))` lines with:

```ts
    const manualItems = await screen.findAllByText("Manual (I'll generate it)")
    await userEvent.click(manualItems[manualItems.length - 1]!)
```

Add a new test at the end of the `describe`:
```ts
  it('shows Manual as the displayed default when unset', () => {
    render(<GenerationProfilePicker profiles={[]} generationProfiles={{}} onChange={() => {}} />)
    expect(screen.getAllByRole('button')[0]).toHaveTextContent("Manual (I'll generate it)")
  })
```

- [ ] **Step 8: Run the picker tests to verify they pass**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/components/generation-profile-picker.test.tsx`
Expected: PASS — Manual shows as the unset default; menu selection still emits `{ image: 'manual' }` / `{ video: 'manual' }`.

- [ ] **Step 9: Commit**

```bash
git add packages/frontend/src/api.ts packages/frontend/src/pages/content-studio/pipeline-settings-dialog.tsx packages/frontend/src/pages/content-studio.tsx packages/frontend/src/pages/content-studio/generation-profile-picker.tsx packages/frontend/tests/pages/pipeline-settings-dialog.test.tsx packages/frontend/tests/components/generation-profile-picker.test.tsx
git commit -m "feat(content-studio): per-project generation profiles in Pipeline Settings"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Rebuild changed workspace packages (dist used by typecheck + cross-package tests)**

Run: `pnpm --filter @anubis/shared build && pnpm --filter @anubis/conversation build`
Expected: both succeed (no-op if already built in Task 1).

- [ ] **Step 2: Typecheck the monorepo**

Run: `pnpm typecheck`
Expected: PASS — no errors across all packages.

- [ ] **Step 3: Run the backend suites touched here**

Run: `pnpm vitest run packages/backend/tests/content-generation/ packages/backend/tests/pipeline-settings.test.ts packages/conversation/tests/db/content-pipeline-settings-repo.test.ts`
Expected: PASS.

- [ ] **Step 4: Run the frontend Content Studio suites**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/components/generation-profile-picker.test.tsx tests/pages/pipeline-settings-dialog.test.tsx tests/pages/generation-sections.test.tsx`
Expected: PASS.

- [ ] **Step 5: Sanity-check the resolution end-to-end (reasoning, no code)**

Confirm by reading the changed files:
- No profiles anywhere → `effectiveProfiles` returns `{ image: undefined, video: undefined }` → `enqueue` marks image+video `manual` → no agent runs; item still reaches `draft` via text.
- Global page picker sets `image: 'codex-image'`, project unset → effective image `codex-image` → image task `pending` → `ConfigurableImageGenerator` runs codex-image.
- Project override sets `image: 'google-flow'` → effective image `google-flow` → generator delegates to Flow (honored even if global is unset).

- [ ] **Step 6: Confirm clean tree**

```bash
git status --short
```
Expected: clean (all five tasks committed).
