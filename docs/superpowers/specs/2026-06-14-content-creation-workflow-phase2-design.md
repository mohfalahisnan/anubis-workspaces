# Content Creation Workflow — Phase 2 (`human_review → generating → draft`)

**Date:** 2026-06-14
**Status:** Approved (design)
**Builds on:** `docs/superpowers/specs/2026-06-14-content-creation-workflow-phase1-design.md`

## Goal

Turn an approved, human-reviewed content item into a stitched **draft package** by
generating its assets through a deterministic, capability-routed orchestrator, then
assembling everything into `draftOutput` and setting status `draft`.

Phase 1 (idea → human_review) is unchanged **except** the human-review **approve** action,
which now advances the item into generation instead of stopping at `human_review`.

## Decisions (locked during brainstorming)

1. **Deterministic orchestrator.** A backend service derives the asset task list from the
   approved refined content + source media kind and dispatches each task to a
   capability-routed generator. No LLM is used for dispatch. Capability→generator mapping
   defaults live in code (pluggable later).
2. **Generators wired for real:** text (final caption / hashtags / text overlay) via the
   existing agent runner; image + carousel via Google Flow (`flowGenerate`). Video, audio,
   and voiceover have no provider → surfaced as **manual** tasks.
3. **Manual start.** Approve sets status `generating` and enqueues tasks as `pending`; the
   user clicks **Start generation** to run them. When all auto tasks complete, the draft is
   stitched and status becomes `draft`.
4. **Unsupported asset types surface as `manual` tasks** — never silently dropped.

## Existing capability inventory (verified)

- **Image generation:** real via Google Flow — `flowGenerate` in
  `packages/research-crawler/src/core/flow/flow-generate.ts`, CDP-driven headed Chrome on the
  `flow` profile, exposed at `POST /research-crawler/flow/generate`. Produces images
  (carousel = multiple image generations). Requires a signed-in Flow window → **not run in
  automated tests**.
- **Text generation:** via `AiAgentService.runAgent` (same engine Phase 1 uses).
- **No video / audio / voiceover provider exists** anywhere in the codebase.

## Status flow change

- Phase 1 today: human-review **approve** → status stays `human_review`.
- Phase 2: approve → status **`generating`** + **enqueue** generation tasks (`pending` /
  `manual`). The user clicks **Start generation**. When all non-manual tasks reach
  `completed`, the orchestrator stitches `draftOutput` and sets status **`draft`**.
- If any auto task is `failed`, status stays `generating` until it is retried and succeeds.
  Manual tasks do **not** block reaching `draft`.

## Data model

### `content_generation_tasks` (new SQLite table, migration 027)

| column | type | notes |
|---|---|---|
| `id` | TEXT PK | |
| `content_id` | TEXT | |
| `project_id` | TEXT NOT NULL DEFAULT 'default' | |
| `type` | TEXT | `final_caption \| final_hashtags \| text_overlay \| image \| carousel \| video \| audio \| voiceover` |
| `capability` | TEXT | `text \| image \| video \| audio \| voiceover` |
| `generator` | TEXT | resolved generator name, or `''` until run |
| `input_prompt` | TEXT | prompt / source text used |
| `status` | TEXT | `pending \| running \| completed \| failed \| cancelled \| manual` |
| `output` | TEXT (JSON) | `{ text }` for text tasks; `{ assetPaths: string[], meta }` for image tasks |
| `error` | TEXT | last error message |
| `retry_count` | INTEGER NOT NULL DEFAULT 0 | |
| `created_at` | INTEGER NOT NULL | |
| `updated_at` | INTEGER NOT NULL | |

Indexes: `(content_id, created_at)`.

### `content_pipeline.draft_output` (new column, migration 027)
JSON column holding the stitched draft package (see Draft stitching).

## Task derivation (pure function, testable)

From the approved `refinedContent` + source `mediaKind`, build the default task list:

- Always: `final_caption` (text) and `final_hashtags` (text) — **carry-forward** from
  `refinedContent` (complete instantly; no agent call by default).
- `text_overlay` (text) — only if `visualBrief.textOverlay` or `copywriting.textOverlay` is
  present.
- Visual:
  - source `mediaKind === 'carousel'` → N `carousel` image tasks (N = number of
    `copywriting.carouselSlides`, else 1).
  - otherwise → a single `image` task.
- `video` / `audio` / `voiceover` → created as **`manual`** tasks when relevant
  (`video` if source `mediaKind === 'video'`; `voiceover` if `copywriting.videoScript`
  exists). Surfaced, never auto-generated.

`enqueue` is idempotent: it clears prior auto tasks for the item before re-deriving (manual
tasks the user has acted on are preserved where practical; simplest correct behaviour =
replace all tasks on re-enqueue).

## Generators + capability routing

A **generator registry** maps `capability → Generator`. A static map resolves
`task.type → capability`. The orchestrator picks the registered generator for a task's
capability, runs it, stores output/status, and retries on failure up to a cap
(default 2 retries). A capability with **no registered generator** (video/audio/voiceover)
leaves the task as **`manual`**.

```
Generator {
  name: string
  capability: GenerationCapability
  generate(task, ctx): Promise<{ output: GenerationOutput }>
}
```

- **`AgentTextGenerator`** (capability `text`) — uses `runAgent` to produce/polish text
  (caption, hashtags, text overlay). Real. (Carry-forward tasks may bypass the agent and
  copy refined content directly.)
- **`FlowImageGenerator`** (capability `image`) — wraps `flowGenerate`, downloads images to
  the asset dir, returns paths. Real; headed; **not exercised in automated tests**.

Generators are **injected** into the orchestrator so unit tests use mock generators; the
Flow adapter is a thin real wrapper validated by hand, not CI.

**Asset storage:** `<dataDir>/content-pipeline/<contentId>/assets/`. The draft references
the stored paths.

## Orchestrator + execution

A deterministic `GenerationService` (backend), constructed with injected deps (task repo,
content/pipeline repos, lessons repo, generator registry, `maxRetries`):

- `enqueue(contentId)` — derive tasks and insert (`pending` / `manual`). Idempotent.
- `runAll(contentId)` — runs as a background `jobManager` job (`kind: 'content-generation'`):
  for each `pending` task, resolve generator by capability, set `running`, run, store
  `output` + `completed` (or `failed` after retries). On terminal failure, create a
  **`generation_failure` lesson**. When all non-manual tasks are `completed`, **stitch** the
  draft and set status `draft`.
- `retryTask(taskId)` — reset a `failed`/`cancelled` task to `pending` and (optionally) run.
- `cancelTask(taskId)` — set a `pending`/`running` task to `cancelled`.

## Draft stitching

When all non-manual tasks are `completed`, assemble **`draftOutput`** (stored in
`content_pipeline.draft_output`) and set status `draft`:

- Final caption, final hashtags
- Generated asset paths + metadata
- Copywriting, platform notes
- Source idea reference (`sourceCandidateId` / reference URL/post)
- Generation metadata (generator/model per task)
- Review history (`aiReview` + `humanReview`)
- Lessons used (recent lessons injected during the run)
- Generation logs (per-task status / error)

## Backend routes (extend `content-items`)

- `POST /content-items/:id/generation/start` — enqueue if empty + start the run job → `{ jobId }`.
- `GET  /content-items/:id/generation` — `{ tasks, draftOutput }`.
- `POST /content-items/:id/generation/tasks/:taskId/retry`.
- `POST /content-items/:id/generation/tasks/:taskId/cancel`.
- Update the Phase 1 `human-review` approve path: on approve, set status `generating` and
  enqueue tasks (via the generation service).

Bodies validated with Zod; route ordering keeps static segments before `/:param`. A test
seam (`__setGenerationProviderForTests`) mirrors Phase 1's pipeline seam so route tests
inject a fake generation service.

## Frontend (Content Studio)

Replace the Phase-2 placeholder cards:

- **Generation Queue** — task list (type, generator, input prompt, status, output, error,
  retry count) with **Start generation**, per-task **retry / cancel**, and view-output. Polls
  the generation job like the Phase 1 pipeline run.
- **Draft Output** — the stitched package (caption, hashtags, asset previews, copywriting,
  platform notes, review history, lessons used, generation logs) with **Mark ready for final
  review** (a flag), **Regenerate assets** (re-enqueue + run), and **Archive** (delete).
- Image previews shown best-effort from stored asset paths (reusing however the Flow page
  surfaces generated images).

The human-review **approve** button now leads into the generating state.

## Shared type additions

`GenerationTaskType`, `GenerationCapability`, `GenerationTaskStatus`, `GenerationTask`,
`GenerationOutput`, `DraftOutput`; and `ContentPipeline.draftOutput?`.

## Out of scope

- Real video / audio / voiceover generation (no provider).
- The post-draft **final draft review** (manual, outside this workflow; its
  `final_draft_review` lesson source already exists from Phase 1).
- A config UI for capability→generator mapping (defaults in code).

## Testing

Unit tests (mock generators + mock repos):
- Task derivation (image vs carousel vs manual video/voiceover; text-overlay gating).
- Capability routing + generator resolution.
- Retry behaviour and `generation_failure` lesson on terminal failure.
- Manual-task handling (left `manual`, doesn't block draft).
- Draft stitching shape and the `generating → draft` transition.
- Generation-task repo round-trip.

Backend route tests with an injected fake generation service (no real agent / Flow).

Operational notes (project memory): rebuild changed `@anubis/*` packages before backend
tests (vitest resolves to `dist`); run with `--maxWorkers=2`. `flowGenerate` already lives in
the packaged dependency graph, so no new root dep is introduced; if a new third-party import
is added it must also go in the root `package.json` dependencies.
