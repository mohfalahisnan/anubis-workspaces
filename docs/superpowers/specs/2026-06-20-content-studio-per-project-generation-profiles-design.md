# Content Studio — per-project generation profiles + Manual-by-default

**Date:** 2026-06-20
**Status:** Approved (design)
**Scope:** Content Studio generation-profile **selection + resolution** (image/video).
Builds directly on [2026-06-20-content-studio-manual-media-generation-design.md](2026-06-20-content-studio-manual-media-generation-design.md)
(the reserved `'manual'` value and prompt-only tasks). Pipeline AI steps, text
carry-forward, voiceover, and the importable workflow are untouched.

## Problem

Generation profiles (`generationProfiles.image` / `.video`) live **only** in the global
`AppConfig`, set by the page-level `GenerationProfilePicker`. There is no per-project
override, and the built-in default is auto-generation (Codex `$imagegen` / HyperFrames).
The user wants:

1. Generation AI Profiles configurable **per project** in the Pipeline Settings dialog,
   overriding the global page picker.
2. **Manual (prompt-only) as the default for both image and video right now** — auto
   media-gen off until explicitly re-enabled.

A second, subtler problem: today the *generators* (`ConfigurableImageGenerator`,
`AgentVideoGenerator`) read the **global** config directly to decide which profile/tool to
run, independently of `enqueue`. If per-project overrides only fed `enqueue`'s
manual-vs-auto gate, a per-project pick of Google Flow or a custom agent profile would be
silently ignored by the generator. So the override must reach **both** consumers.

## Goal

One resolution rule, used by every consumer:

```
effective.image = projectOverride.image ?? globalConfig.image ?? MANUAL_PROFILE_ID
effective.video = projectOverride.video ?? globalConfig.video ?? MANUAL_PROFILE_ID
```

- Unset anywhere ⇒ `'manual'` (new default — image **and** video prompt-only).
- A field is "manual" when its effective value is `'manual'`.
- Both `enqueue` (manual gate) and the generators (profile/tool selection) read the
  effective value, so per-project Flow / agent picks are honored.

Decisions (confirmed with user):
- **Default:** both image and video default to Manual.
- **Layering:** per-project override → global page picker → built-in default (`manual`).
- **The global page picker stays** as the global-default layer; Pipeline Settings adds the
  per-project override.

## Approach (chosen)

### 1. Storage

Migration `034_content_pipeline_settings_generation.sql`:

```sql
ALTER TABLE content_pipeline_settings
  ADD COLUMN generation_profiles TEXT NOT NULL DEFAULT '{}';
```

`PipelineSettings` (shared) gains `generationProfiles?: GenerationProfileConfig`.
`ContentPipelineSettingsRepo`:
- `get` parses the new column into `generationProfiles` (default `{}` → omit when empty).
- `put` signature widens to `put(projectId, { steps, generationProfiles })` and persists
  both columns in the existing upsert.

### 2. Route

`/pipeline-settings` PUT body extends:

```ts
const GenerationProfilesSchema = z.object({
  image: z.string().optional(),
  video: z.string().optional(),
}).strict()

const SettingsBody = z.object({
  steps: z.object({ brief: …, refine: …, ai_review: … }),
  generationProfiles: GenerationProfilesSchema.optional(),
}).strict()
```

GET already returns the whole `PipelineSettings`, so it carries `generationProfiles` once
the repo populates it.

### 3. Backend resolution + wiring

In [content-generation/factory.ts](../../../packages/backend/src/content-generation/factory.ts):

```ts
const effectiveProfiles = (projectId: string): GenerationProfileConfig => {
  const project = stack.contentPipelineSettings.get(projectId).generationProfiles
  const global = stack.appConfig.get().generationProfiles
  return { image: project?.image ?? global?.image, video: project?.video ?? global?.video }
}
```

- **GenerationService**: replace the `getConfig` dep (added in the prior change) with
  `getGenerationProfiles: (projectId: string) => GenerationProfileConfig`. `enqueue`:

  ```ts
  const gp = this.deps.getGenerationProfiles(item.projectId)
  const manual = {
    image: (gp.image ?? MANUAL_PROFILE_ID) === MANUAL_PROFILE_ID,
    video: (gp.video ?? MANUAL_PROFILE_ID) === MANUAL_PROFILE_ID,
  }
  ```

- **Generators** ([agent-generators.ts](../../../packages/backend/src/content-generation/agent-generators.ts)):
  swap the selection read from global `getConfig().generationProfiles` to a
  `getProfiles: (projectId) => GenerationProfileConfig` dep keyed on `ctx.projectId`.
  - `ConfigurableImageGenerator`: `const selected = this.deps.getProfiles(ctx.projectId).image`;
    `selected === FLOW_IMAGE_PROFILE_ID` → Flow; else `profileId = selected ?? 'codex-image'`.
  - `AgentVideoGenerator`: `const profileId = this.deps.getProfiles(ctx.projectId).video ?? 'codex-video'`.
  - `FlowImageGenerator` keeps its global `getConfig` (used for `chromePath`, not selection).

  When a media task actually runs it is non-manual by construction (manual tasks never reach
  a generator), so `selected` is a real profile id / `'google-flow'`; the `?? 'codex-*'`
  fallbacks are only defensive.

### 4. Frontend

- **`updatePipelineSettings`** ([api.ts](../../../packages/frontend/src/api.ts)) signature:
  `updatePipelineSettings(projectId, steps, generationProfiles?)`, sending both in the PUT body.
- **`PipelineSettingsDialog`**: add a **"Media generation"** section using the existing
  `GenerationProfilePicker` (Image + Video). It receives a new `profiles: ProfileSummary[]`
  prop (passed from [content-studio.tsx](../../../packages/frontend/src/pages/content-studio.tsx),
  which already loads `profiles`). Local state `generationProfiles` initializes from the
  loaded `settings.generationProfiles ?? {}`; a "Reset to default (Manual)" button clears it
  to `{}`. On save, `updatePipelineSettings(projectId, clean(steps), generationProfiles)` —
  empty object omitted.
- **Picker default display**: `resolveProfile` in
  [generation-profile-picker.tsx](../../../packages/frontend/src/pages/content-studio/generation-profile-picker.tsx)
  falls back to the Manual option when the id is unset, so both the page-level and dialog
  pickers show **"Manual (I'll generate it)"** when nothing is configured — matching the new
  default.

## Components & boundaries

| Unit | Responsibility | Change |
| --- | --- | --- |
| migration 034 | add `generation_profiles` column | Create |
| `shared/PipelineSettings` | per-project settings shape | add `generationProfiles?` |
| `ContentPipelineSettingsRepo` | read/write per-project settings | get/put handle new column |
| `pipeline-settings.ts` route | validate + persist | extend body + put call |
| `content-generation/factory.ts` | wire deps + `effectiveProfiles` | resolver + inject |
| `generation-service.ts` | enqueue manual gate | `getGenerationProfiles` dep |
| `agent-generators.ts` | image/video generators | `getProfiles(projectId)` selection |
| `api.ts` | client | `updatePipelineSettings` signature |
| `pipeline-settings-dialog.tsx` | per-project settings UI | Media generation section |
| `generation-profile-picker.tsx` | picker | Manual default display |
| `content-studio.tsx` | page | pass `profiles` to dialog |

## Testing

- **Repo**: `put` then `get` round-trips `generationProfiles`; absent row → `{}`.
- **Route**: PUT `{ steps, generationProfiles: { image: 'manual' } }` persists; GET returns it.
- **factory `effectiveProfiles`** (unit, via the resolver or a service test): project over
  global over `manual` default for each field.
- **`enqueue`**: no profiles → image+video tasks `manual`; project override `image:'codex-image'`
  → image task `pending`; still reaches `draft`.
- **Generators**: `ConfigurableImageGenerator` delegates to Flow when effective image is
  `'google-flow'`; `AgentVideoGenerator` uses the effective video profile id.
- **Frontend**: dialog renders the Media generation pickers, save calls
  `updatePipelineSettings` with `generationProfiles`; picker shows Manual when unset.

## Out of scope / non-goals

- Uploading manually-generated files back into the draft (still prompt-only).
- Per-item (vs per-project) generation-profile overrides.
- Changing the importable `content-studio.workflow.json`.
- Per-step generation overrides beyond image/video (e.g. text/voiceover stay as-is).

## Migration / behavior-change note

Making `'manual'` the built-in default is a **global behavior change**: existing projects
with no configured profile switch from auto-generation to prompt-only for both image and
video. Re-enable by selecting Codex/Flow/an agent profile in Pipeline Settings (per project)
or the page-level picker (global). This supersedes the prior change's `getConfig` dependency
on `GenerationService` with the project-aware `getGenerationProfiles`.
