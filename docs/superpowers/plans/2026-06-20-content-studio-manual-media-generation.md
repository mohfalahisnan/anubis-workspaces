# Content Studio — Manual Media Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reserved `'manual'` option to the Content Studio media-source picker so image/carousel/video are derived as prompt-only tasks (no agent run), while text still carries forward and the item still advances to Draft.

**Architecture:** A `manual` task status already exists and is skipped by `runAll` and excluded from `finalize`'s auto-set (voiceover already uses it). So the change is: (1) derive the media tasks as `manual` when the project's `generationProfiles.image`/`.video` is `'manual'`, (2) wire app config into `GenerationService.enqueue`, and (3) surface the new picker option plus a full-prompt + Copy-button UI for manual tasks. The importable workflow and the existing Codex/Flow auto-generation are untouched.

**Tech Stack:** TypeScript (ESM), Hono backend, React 19 + Vite frontend, Vitest + @testing-library/react.

**Spec:** [docs/superpowers/specs/2026-06-20-content-studio-manual-media-generation-design.md](../specs/2026-06-20-content-studio-manual-media-generation-design.md)

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `packages/backend/src/content-generation/derive-tasks.ts` | refined content → task specs; owns `MANUAL_PROFILE_ID` + manual flags | Modify |
| `packages/shared/src/index.ts` | config shape doc | Modify (comment only) |
| `packages/backend/src/content-generation/generation-service.ts` | enqueue reads config, passes manual flags | Modify |
| `packages/backend/src/content-generation/factory.ts` | inject `getConfig` dep | Modify |
| `packages/frontend/src/pages/content-studio/generation-profile-picker.tsx` | add Manual option to Image + Video pickers | Modify |
| `packages/frontend/src/pages/content-studio/generation-sections.tsx` | full prompt + Copy button for manual tasks | Modify |
| `packages/backend/tests/content-generation/derive-tasks.test.ts` | manual-flag derivation tests | Modify |
| `packages/backend/tests/content-generation/generation-service.test.ts` | enqueue-with-config tests | Modify |
| `packages/frontend/tests/components/generation-profile-picker.test.tsx` | picker Manual option test | Create |
| `packages/frontend/tests/pages/generation-sections.test.tsx` | manual prompt + Copy test | Create |

---

## Task 1: `deriveTasks` manual flags + `MANUAL_PROFILE_ID`

**Files:**
- Modify: `packages/backend/src/content-generation/derive-tasks.ts`
- Modify: `packages/shared/src/index.ts` (doc comment only)
- Test: `packages/backend/tests/content-generation/derive-tasks.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these cases inside the existing `describe('deriveTasks', …)` block in `packages/backend/tests/content-generation/derive-tasks.test.ts` (the `refined()` helper already exists at the top of the file):

```ts
  it('manual.image → image task is manual (prompt-only)', () => {
    const tasks = deriveTasks(refined(), 'image', { image: true })
    expect(tasks.find((t) => t.type === 'image')?.status).toBe('manual')
  })

  it('manual.image → every carousel task is manual', () => {
    const r = refined({ copywriting: { hook: 'h', body: 'b', cta: 'c', carouselSlides: ['s1', 's2'] } })
    const tasks = deriveTasks(r, 'carousel', { image: true })
    const carousel = tasks.filter((t) => t.type === 'carousel')
    expect(carousel).toHaveLength(2)
    expect(carousel.every((t) => t.status === 'manual')).toBe(true)
  })

  it('manual.video → video task is manual; text tasks stay pending', () => {
    const r = refined({ copywriting: { hook: 'h', body: 'b', cta: 'c', videoScript: 'read this' } })
    const tasks = deriveTasks(r, 'video', { video: true })
    expect(tasks.find((t) => t.type === 'video')?.status).toBe('manual')
    expect(tasks.find((t) => t.type === 'final_caption')?.status).toBe('pending')
  })

  it('no manual arg → media stays pending (unchanged default)', () => {
    const tasks = deriveTasks(refined(), 'image')
    expect(tasks.find((t) => t.type === 'image')?.status).toBe('pending')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/backend/tests/content-generation/derive-tasks.test.ts`
Expected: FAIL — the `manual.image`/`manual.video` cases fail because `deriveTasks` ignores the third argument and the media tasks are still `pending`.

- [ ] **Step 3: Implement the manual flags + constant**

In `packages/backend/src/content-generation/derive-tasks.ts`, the imports already include `GenerationTaskStatus`. Add the constant and a flags interface near the top (after the imports), then replace the `deriveTasks` function.

Add after the existing `import` line:

```ts
/** Reserved generation-profile value selecting manual (prompt-only) media generation. */
export const MANUAL_PROFILE_ID = 'manual'

export interface ManualMediaFlags {
  image?: boolean
  video?: boolean
}
```

Replace the whole `deriveTasks` function with:

```ts
export function deriveTasks(
  refined: RefinedContent,
  mediaKind: 'image' | 'video' | 'carousel' | undefined,
  manual: ManualMediaFlags = {},
): TaskSpec[] {
  const tasks: TaskSpec[] = []

  // Text — carry-forward from the refined content.
  tasks.push(spec('final_caption', refined.caption))
  const hashtags = [...refined.hashtags.primary, ...refined.hashtags.niche, ...refined.hashtags.brandSafe]
  tasks.push(spec('final_hashtags', hashtags.join(' ')))

  const overlay = refined.visualBrief.textOverlay ?? refined.copywriting.textOverlay
  if (overlay) tasks.push(spec('text_overlay', overlay))

  // Visual. When the project opted out of auto-generation (`manual.image`), derive the
  // media task as `manual` so it surfaces the prompt but never runs a generator.
  const imageStatus: GenerationTaskStatus = manual.image ? 'manual' : 'pending'
  if (mediaKind === 'carousel') {
    const slides = refined.copywriting.carouselSlides?.length ? refined.copywriting.carouselSlides : ['']
    for (const slide of slides) tasks.push(spec('carousel', buildImagePrompt(refined.visualBrief, slide), imageStatus))
  } else {
    tasks.push(spec('image', buildImagePrompt(refined.visualBrief), imageStatus))
  }

  // Video is generatable via the hyperframes agent generator unless opted out; voiceover stays manual.
  if (mediaKind === 'video') tasks.push(spec('video', refined.copywriting.videoScript ?? refined.visualBrief.concept, manual.video ? 'manual' : 'pending'))
  if (refined.copywriting.videoScript) tasks.push(spec('voiceover', refined.copywriting.videoScript, 'manual'))

  return tasks
}
```

- [ ] **Step 4: Update the shared doc comment**

In `packages/shared/src/index.ts`, update the `GenerationProfileConfig` doc comments (around line 1087) to mention the reserved `'manual'` value:

```ts
export interface GenerationProfileConfig {
  /** Profile id, or the reserved 'google-flow' / 'manual' value, for image generation. */
  image?: string
  /** Profile id, or the reserved 'manual' value, for video (HyperFrames) generation. */
  video?: string
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/backend/tests/content-generation/derive-tasks.test.ts`
Expected: PASS — all cases (existing + new) green.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/content-generation/derive-tasks.ts packages/shared/src/index.ts packages/backend/tests/content-generation/derive-tasks.test.ts
git commit -m "feat(content-studio): derive media tasks as manual when opted out"
```

---

## Task 2: `GenerationService.enqueue` reads config

**Files:**
- Modify: `packages/backend/src/content-generation/generation-service.ts`
- Modify: `packages/backend/src/content-generation/factory.ts`
- Test: `packages/backend/tests/content-generation/generation-service.test.ts`

- [ ] **Step 1: Add `getConfig` to the test deps + write the failing test**

In `packages/backend/tests/content-generation/generation-service.test.ts`, add a default `getConfig` to the `deps` object returned by `makeDeps` (place it next to `maxRetries: 2,`):

```ts
      maxRetries: 2,
      getConfig: vi.fn(() => ({})),
```

Then add a new `describe` block at the end of the file:

```ts
describe('GenerationService.enqueue with manual media', () => {
  it('image profile = manual → image task is manual and never runs, item still reaches draft', async () => {
    const { deps, tasks, statuses } = makeDeps({ getConfig: vi.fn(() => ({ generationProfiles: { image: 'manual' } })) })
    const svc = new GenerationService(deps as never)
    svc.enqueue('c1')
    expect(tasks().find((t) => t.type === 'image')!.status).toBe('manual')
    await svc.runAll('c1')
    expect(statuses).toContain('draft')
    expect(tasks().find((t) => t.type === 'image')!.status).toBe('manual')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/backend/tests/content-generation/generation-service.test.ts`
Expected: FAIL — `enqueue` ignores config, so the image task is created `pending` (and `runAll` would run it), not `manual`. (It may also throw `getConfig is not a function` before the source change in Step 3 — that's the expected red.)

- [ ] **Step 3: Wire config into `enqueue`**

In `packages/backend/src/content-generation/generation-service.ts`:

Add `GenerationProfileConfig` to the shared type import (top of file):

```ts
import type {
  ContentLesson, ContentPipeline, DraftOutput, GenerationProfileConfig, GenerationTask, LessonType,
} from '@anubis/shared'
```

Change the `deriveTasks` import to also bring in the constant:

```ts
import { deriveTasks, MANUAL_PROFILE_ID } from './derive-tasks.js'
```

Add a `getConfig` field to the `GenerationDeps` interface (place it next to `maxRetries: number`):

```ts
  /** Read app config to resolve the project's generation profiles (manual / flow / agent). */
  getConfig: () => { generationProfiles?: GenerationProfileConfig }
  maxRetries: number
```

Replace the `enqueue` method body:

```ts
  enqueue(id: string): GenerationTask[] {
    const item = this.requireItem(id)
    const pipeline = this.deps.pipeline.get(id)
    if (!pipeline.refinedContent) throw new Error('Cannot generate before refined content exists.')
    const mediaKind = pipeline.rawIdea?.mediaKind
    const gp = this.deps.getConfig().generationProfiles
    const manual = { image: gp?.image === MANUAL_PROFILE_ID, video: gp?.video === MANUAL_PROFILE_ID }
    const specs = deriveTasks(pipeline.refinedContent, mediaKind, manual)
    this.deps.taskRepo.deleteByContent(id)
    return specs.map((s) => this.deps.taskRepo.create({ contentId: id, projectId: item.projectId, ...s }))
  }
```

- [ ] **Step 4: Inject `getConfig` in the factory**

In `packages/backend/src/content-generation/factory.ts`, the `getConfig` helper already exists (`const getConfig = () => stack.appConfig.get()`). Add it to the `deps` object — place it next to `maxRetries: MAX_RETRIES,`:

```ts
    maxRetries: MAX_RETRIES,
    getConfig,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run packages/backend/tests/content-generation/generation-service.test.ts`
Expected: PASS — image task is `manual`, never runs, and the item still reaches `draft` via the text tasks. Existing enqueue/runAll tests stay green (default `getConfig` returns `{}` → no manual flags).

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/content-generation/generation-service.ts packages/backend/src/content-generation/factory.ts packages/backend/tests/content-generation/generation-service.test.ts
git commit -m "feat(content-studio): enqueue honors manual generation profiles"
```

---

## Task 3: Frontend — Manual option in the media-source picker

**Files:**
- Modify: `packages/frontend/src/pages/content-studio/generation-profile-picker.tsx`
- Test: `packages/frontend/tests/components/generation-profile-picker.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/components/generation-profile-picker.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GenerationProfilePicker } from '@/pages/content-studio/generation-profile-picker'

describe('<GenerationProfilePicker>', () => {
  it('offers a Manual option on the Image picker and emits image=manual', async () => {
    const onChange = vi.fn()
    render(<GenerationProfilePicker profiles={[]} generationProfiles={{}} onChange={onChange} />)
    const buttons = screen.getAllByRole('button')
    await userEvent.click(buttons[0]!) // Image picker (rendered first)
    await userEvent.click(await screen.findByText("Manual (I'll generate it)"))
    expect(onChange).toHaveBeenCalledWith({ image: 'manual' })
  })

  it('offers a Manual option on the Video picker and emits video=manual', async () => {
    const onChange = vi.fn()
    render(<GenerationProfilePicker profiles={[]} generationProfiles={{}} onChange={onChange} />)
    const buttons = screen.getAllByRole('button')
    await userEvent.click(buttons[1]!) // Video picker (rendered second)
    await userEvent.click(await screen.findByText("Manual (I'll generate it)"))
    expect(onChange).toHaveBeenCalledWith({ video: 'manual' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/components/generation-profile-picker.test.tsx`
Expected: FAIL — there is no "Manual (I'll generate it)" option yet, so `findByText` times out.

- [ ] **Step 3: Add the Manual option**

In `packages/frontend/src/pages/content-studio/generation-profile-picker.tsx`:

Add the constant + option below the existing `FLOW_IMAGE_PROFILE_ID` / `FLOW_OPTION` declarations:

```ts
/** Must match MANUAL_PROFILE_ID in the backend derive-tasks module. */
const MANUAL_PROFILE_ID = 'manual'

const MANUAL_OPTION: ProfileSummary = {
  id: MANUAL_PROFILE_ID,
  name: "Manual (I'll generate it)",
  description: 'Produce the prompt only — generate the media yourself, no agent run.',
  source: 'builtin',
  config: { agent: 'codex' },
  sortOrder: -1,
  createdAt: 0,
  updatedAt: 0,
}
```

Replace the body of the component (from the `imageProfiles` memo through the returned JSX) so both pickers include Manual and resolve it:

```tsx
  const imageProfiles = useMemo(() => [MANUAL_OPTION, FLOW_OPTION, ...agentProfiles], [agentProfiles])
  const videoProfiles = useMemo(() => [MANUAL_OPTION, ...agentProfiles], [agentProfiles])

  return (
    <div className='flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border/60 bg-card/50 px-3 py-2'>
      <span className='flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground'>
        Generation AI Profiles
      </span>
      <div className='flex items-center gap-2'>
        <span className='flex items-center gap-1 text-[11.5px] text-muted-foreground'><ImageIcon className='size-3.5' /> Image</span>
        <ProfilePicker
          profiles={imageProfiles}
          value={resolveProfile(imageProfiles, generationProfiles.image)}
          onChange={(p) => onChange({ ...generationProfiles, image: p.id })}
        />
      </div>
      <div className='flex items-center gap-2'>
        <span className='flex items-center gap-1 text-[11.5px] text-muted-foreground'><VideoIcon className='size-3.5' /> Video</span>
        <ProfilePicker
          profiles={videoProfiles}
          value={resolveProfile(videoProfiles, generationProfiles.video)}
          onChange={(p) => onChange({ ...generationProfiles, video: p.id })}
        />
      </div>
    </div>
  )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/components/generation-profile-picker.test.tsx`
Expected: PASS — both pickers expose Manual and emit `{ image: 'manual' }` / `{ video: 'manual' }`.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/pages/content-studio/generation-profile-picker.tsx packages/frontend/tests/components/generation-profile-picker.test.tsx
git commit -m "feat(content-studio): add Manual option to media generation picker"
```

---

## Task 4: Frontend — full prompt + Copy button for manual tasks

**Files:**
- Modify: `packages/frontend/src/pages/content-studio/generation-sections.tsx`
- Test: `packages/frontend/tests/pages/generation-sections.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/pages/generation-sections.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GenerationTask } from '@anubis/shared'
import { GenerationQueueSection } from '@/pages/content-studio/generation-sections'

function task(over: Partial<GenerationTask>): GenerationTask {
  return {
    id: 't1', contentId: 'c1', projectId: 'p', type: 'image', capability: 'image',
    generator: '', inputPrompt: 'FULL PROMPT TEXT', status: 'manual',
    retryCount: 0, createdAt: 0, updatedAt: 0, ...over,
  }
}

function renderQueue(tasks: GenerationTask[]) {
  render(
    <GenerationQueueSection
      tasks={tasks} busy={false}
      onStart={() => {}} onRetry={() => {}} onCancel={() => {}} onOpenConversation={() => {}}
    />,
  )
}

describe('<GenerationQueueSection> manual tasks', () => {
  it('shows the full prompt and a Copy prompt button that copies the prompt', async () => {
    const writeText = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })
    renderQueue([task({})])
    expect(screen.getByText('FULL PROMPT TEXT')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /copy prompt/i }))
    expect(writeText).toHaveBeenCalledWith('FULL PROMPT TEXT')
  })

  it('does not show a Copy prompt button for non-manual tasks', () => {
    renderQueue([task({ status: 'pending' })])
    expect(screen.queryByRole('button', { name: /copy prompt/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/pages/generation-sections.test.tsx`
Expected: FAIL — there is no "Copy prompt" button; the prompt is rendered line-clamped (still found by text, but the Copy button assertion fails).

- [ ] **Step 3: Render the full prompt + Copy button for manual tasks**

In `packages/frontend/src/pages/content-studio/generation-sections.tsx`, replace the single prompt line inside the task `<li>`:

```tsx
              <p className='mt-1 line-clamp-2 text-[11.5px] text-muted-foreground'>{t.inputPrompt}</p>
```

with a manual-aware block:

```tsx
              {t.status === 'manual' ? (
                <div className='mt-1'>
                  <p className='whitespace-pre-wrap text-[11.5px] text-muted-foreground'>{t.inputPrompt}</p>
                  <button
                    type='button'
                    onClick={() => { void navigator.clipboard?.writeText(t.inputPrompt) }}
                    className='mt-1 text-[11px] text-[var(--anubis-gold)] hover:underline'
                  >
                    Copy prompt
                  </button>
                </div>
              ) : (
                <p className='mt-1 line-clamp-2 text-[11.5px] text-muted-foreground'>{t.inputPrompt}</p>
              )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/pages/generation-sections.test.tsx`
Expected: PASS — manual tasks show the full prompt + a working Copy prompt button; non-manual tasks don't.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/pages/content-studio/generation-sections.tsx packages/frontend/tests/pages/generation-sections.test.tsx
git commit -m "feat(content-studio): show full prompt + copy for manual generation tasks"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole monorepo**

Run: `pnpm typecheck`
Expected: PASS — no errors. (Only a doc comment changed in `@anubis/shared`, so no rebuild is required for the new behavior; if typecheck resolves `@anubis/*` to stale `dist`, run `pnpm --filter @anubis/shared build` first.)

- [ ] **Step 2: Run the backend content-generation tests**

Run: `pnpm vitest run packages/backend/tests/content-generation/derive-tasks.test.ts packages/backend/tests/content-generation/generation-service.test.ts`
Expected: PASS — all green.

- [ ] **Step 3: Run the frontend Content Studio tests**

Run: `pnpm --filter @anubis/frontend exec vitest run tests/components/generation-profile-picker.test.tsx tests/pages/generation-sections.test.tsx`
Expected: PASS — all green.

- [ ] **Step 4: Sanity-check the manual flow end-to-end (reasoning, no code)**

Confirm by reading the changed files that, with `generationProfiles.image = 'manual'`:
- `enqueue` derives the `image`/`carousel` task with status `'manual'`.
- `runAll` skips it (only runs `pending`), so no `$imagegen`/Flow agent runs.
- `finalize` settles on the text tasks and advances the item to `draft`.
- The Generation Queue shows the full image prompt + a Copy prompt button.

- [ ] **Step 5: Final commit (if any uncommitted verification fixups)**

```bash
git status   # expect clean if Tasks 1-4 were committed
```
