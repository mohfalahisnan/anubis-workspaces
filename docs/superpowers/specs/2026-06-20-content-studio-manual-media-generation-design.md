# Content Studio — manual media generation

**Date:** 2026-06-20
**Status:** Approved (design)
**Scope:** Content Studio **page pipeline** generation only — the `image`, `carousel`,
and `video` capabilities. Pipeline steps (extract/breakdown/refine/ai-review), the text
carry-forward, voiceover, and the importable `content-studio.workflow.json` are untouched.

## Problem

After Human Review is approved, the Content Studio item advances to `generating` and
[`GenerationService`](../../../packages/backend/src/content-generation/generation-service.ts)
runs every derived task through a generator.
[`deriveTasks`](../../../packages/backend/src/content-generation/derive-tasks.ts) marks
`image`/`carousel`/`video` as `pending`, so they **auto-run** the Codex `$imagegen` /
HyperFrames agents
([`agent-generators.ts`](../../../packages/backend/src/content-generation/agent-generators.ts)).

The user wants to generate image/video media **by hand** in their own tools. The pipeline
should produce the prompt + directions for those media and stop there — not run an agent.

## Goal

Let a project opt out of auto-generating image/carousel/video. When opted out, the
pipeline derives the media prompt and leaves the task in a `manual` state (no agent runs),
surfacing the full prompt for the user to copy. Text (caption/hashtags) still carries
forward and the item still advances to `draft`.

Decisions (confirmed with user):
- **Control:** configurable per project via the existing media-source picker — add a
  reserved `'manual'` option alongside the Codex agent / Google Flow choices. Codex/Flow
  auto-generation still works when selected.
- **After prompt:** prompt-only. The task shows the full prompt + a Copy button; the user
  generates the file outside Anubis. No upload-back, no new asset ingestion path.
- **Item still advances:** with media manual, the text tasks settle and the item moves to
  `draft` (text-only). Media tasks remain visible as `manual` with their prompts. Nothing
  parks in `generating`.

## Approach (chosen)

A `manual` task is already a first-class status: `runAll` only runs `pending`, and
`finalize()` excludes `manual` tasks from the `auto` set. `voiceover` already uses it. So
the change is to **derive the media tasks as `manual`** when the project opts out, and make
the UI expose the prompt and the new picker option.

### 1. Reserved `'manual'` profile value

`GenerationProfileConfig.image` / `.video`
([`packages/shared/src/index.ts`](../../../packages/shared/src/index.ts)) hold a profile id
or the reserved `'google-flow'`. Add `'manual'` as another reserved value.

- Define `MANUAL_PROFILE_ID = 'manual'` in
  [`derive-tasks.ts`](../../../packages/backend/src/content-generation/derive-tasks.ts) and
  export it.
- Mirror it in the frontend picker with a `// Must match MANUAL_PROFILE_ID` comment — the
  same duplication pattern the codebase already uses for `FLOW_IMAGE_PROFILE_ID`.
- Update the doc comment on `GenerationProfileConfig` to mention `'manual'`.

### 2. Derive media tasks as `manual` when opted out

[`deriveTasks`](../../../packages/backend/src/content-generation/derive-tasks.ts:41) gains a
parameter:

```ts
deriveTasks(refined, mediaKind, manual?: { image?: boolean; video?: boolean })
```

- `manual.image` → the `image` **and** `carousel` specs are created with status `'manual'`
  (carousel is image-capability).
- `manual.video` → the `video` spec is created with status `'manual'`.
- Text specs (`final_caption`, `final_hashtags`, `text_overlay`) and `voiceover` are
  unchanged.

The brief stored in `inputPrompt` — `buildImagePrompt(visualBrief)` for image/carousel, the
video script for video — **is** the prompt + directions. No agent-wrapper text
(`$imagegen` / HyperFrames steps from `agent-generators.ts`) is applied, because manual
tasks never reach a generator.

### 3. Wire config into enqueue

[`GenerationService`](../../../packages/backend/src/content-generation/generation-service.ts)
gains a `getConfig` (or equivalent `generationProfiles` getter) dependency, wired in
[`factory.ts`](../../../packages/backend/src/content-generation/factory.ts) where
`getConfig` already exists.
[`enqueue`](../../../packages/backend/src/content-generation/generation-service.ts:48)
computes the manual flags:

```ts
const gp = this.deps.getConfig().generationProfiles
const manual = { image: gp?.image === MANUAL_PROFILE_ID, video: gp?.video === MANUAL_PROFILE_ID }
const specs = deriveTasks(pipeline.refinedContent, mediaKind, manual)
```

### 4. Flow still completes (no code change, verified by reasoning + test)

`deriveTasks` always emits `final_caption` + `final_hashtags` (text capability), which
`TextGenerator` completes deterministically. So in `finalize()` the `auto` set is non-empty
and settles → `stitchDraft` → item advances to `draft`. Manual media tasks are excluded
from `auto` and remain `manual`. The draft contains text but no media assets — expected for
prompt-only mode.

### 5. UI

- [`GenerationProfilePicker`](../../../packages/frontend/src/pages/content-studio/generation-profile-picker.tsx):
  add a synthetic **"Manual (I'll generate it)"** option (id `manual`) to both the Image and
  Video pickers — same `ProfileSummary` shim approach as `FLOW_OPTION`.
- [`generation-sections.tsx`](../../../packages/frontend/src/pages/content-studio/generation-sections.tsx):
  for tasks with status `manual`, render the **full** `inputPrompt` (drop the
  `line-clamp-2`) in a selectable block plus a **Copy prompt** button. Non-manual tasks keep
  the current clamped preview. (This also improves the existing `voiceover` manual task.)

## Components & boundaries

| Unit | Responsibility | Change |
| --- | --- | --- |
| `shared/GenerationProfileConfig` | config shape + reserved values | doc comment only |
| `derive-tasks.ts` | refined content → task specs | new `manual` param; owns `MANUAL_PROFILE_ID` |
| `generation-service.ts` | enqueue/run/finalize tasks | read config, pass manual flags |
| `factory.ts` | wire deps | inject `getConfig` |
| `generation-profile-picker.tsx` | choose media source | add Manual option |
| `generation-sections.tsx` | render task queue | full prompt + copy for manual tasks |

## Testing

- `derive-tasks`: `manual.image` → `image`/`carousel` specs are `manual`; `manual.video` →
  `video` spec is `manual`; text/voiceover specs unchanged; default (no manual arg) keeps
  current `pending` behavior.
- `generation-service`: `enqueue` with `generationProfiles.image = 'manual'` creates the
  image/carousel tasks as `manual` and does not run them; `finalize` still reaches `draft`
  via the text tasks.
- Frontend: picker exposes the Manual option and round-trips `image/video = 'manual'`
  through `onChange`.

## Out of scope / non-goals

- Uploading manually-generated files back into the draft/assets.
- Any change to the importable `content-studio.workflow.json` or its `imageVideo` node.
- Changing Codex/Flow auto-generation behavior when those profiles are selected.
- Per-task (vs per-project) manual overrides.
