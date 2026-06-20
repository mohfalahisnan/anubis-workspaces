# Content Studio — Image/Video generation tabs with editable prompts

**Date:** 2026-06-20
**Status:** Approved (design)
**Scope:** Content Studio **Pipeline Settings** dialog + the image/video generation
**prompt** (the `inputPrompt` derived for each media task). Builds on
[2026-06-20-content-studio-per-project-generation-profiles-design.md](2026-06-20-content-studio-per-project-generation-profiles-design.md)
(per-project `generationProfiles`). AI-step prompts, resolution of generation *profiles*,
and the importable workflow are untouched.

## Problem

Two issues:
1. **No editable prompt for image/video generation.** The image/carousel prompt is the
   hardcoded `buildImagePrompt(visualBrief)` in
   [derive-tasks.ts](../../../packages/backend/src/content-generation/derive-tasks.ts); the
   video prompt is `copywriting.videoScript ?? visualBrief.concept`. Only the 3 AI steps
   (Breakdown/Refine/AI Review) have editable `promptTemplate` overrides. The only way to
   shape the generation prompt today is to edit the Refine template.
2. **Inconsistent UI.** The per-project generation profile picker was bolted onto the bottom
   of the Pipeline Settings dialog as a separate block, while the AI steps use a tab strip.

## Goal

- Add **Image** and **Video** as first-class tabs in the Pipeline Settings dialog, beside
  Breakdown / Refine / AI Review. Remove the bottom "Media generation" block; its pickers
  move into the new tabs.
- Each media tab exposes the **profile picker** (Manual / Codex / Flow / agent) **and** an
  **editable generation-prompt template** with placeholders, with the same UX as the AI-step
  tabs (default shown, "Edit from default", "Reset to default", blank = default).
- The generation prompt template is the single source for both the auto-generation agent
  prompt and the Manual copy text.

Decisions (confirmed with user):
- Both a profile picker and an editable prompt per media tab ("Tabs + editable prompt").
- Model/effort/temperature are **not** exposed on media tabs (generation uses the selected
  profile's own agent settings).

## Approach (chosen)

### 1. Default generation templates

Add to [prompts.ts](../../../packages/backend/src/content-pipeline/prompts.ts):

```ts
export interface GenerationPromptDefaults { image: string; video: string }

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
```

Vars (built in derive-tasks from the refined content):
- image: `concept, sceneDirection, subject, layout, mood, style, keyElements` (joined `, `),
  `textOverlay` (`visualBrief.textOverlay ?? ''`), `slide` (per carousel slide; `''`
  otherwise), `negativeDirection`.
- video: `videoScript` = `copywriting.videoScript || visualBrief.concept`.

Rendering reuses the existing `renderPrompt(template, vars)` (replaces missing keys with
`''`). Empty placeholders render to blank lines/labels — acceptable for an editable default.

### 2. deriveTasks renders the template

[`deriveTasks`](../../../packages/backend/src/content-generation/derive-tasks.ts) replaces
the hardcoded `buildImagePrompt` call with a render of
`prompts.image ?? DEFAULT_GENERATION_TEMPLATES.image` (and video likewise). New signature:

```ts
deriveTasks(refined, mediaKind, manual?, prompts?: { image?: string; video?: string })
```

- Image/carousel: render the image template; for carousel, render once per slide with the
  `slide` var set.
- Video: render the video template.
- `buildImagePrompt` is **replaced** by a `renderGenerationPrompt(template, refined, slide?)`
  helper (exported for tests). Output is content-equivalent to the old composer; existing
  tests assert via `contains`, not exact string.

This single path feeds both the Manual copy text (`task.inputPrompt`) and the
auto-generation agent (which wraps `task.inputPrompt`). Generators are unchanged.

### 3. enqueue passes per-project prompts

Generation prompts are **per-project only** (no global layer), matching AI-step prompts:
`projectTemplate ?? built-in default`. `GenerationService` gains a
`getGenerationPrompts: (projectId) => { image?: string; video?: string }` dep, wired in
[factory.ts](../../../packages/backend/src/content-generation/factory.ts) from
`stack.contentPipelineSettings.get(projectId).generationPrompts`. `enqueue` passes the
resolved prompts to `deriveTasks`. Profile resolution (`project → global → manual`) is
unchanged.

### 4. Storage

Migration `035_content_pipeline_settings_generation_prompts.sql`:

```sql
ALTER TABLE content_pipeline_settings
  ADD COLUMN generation_prompts TEXT NOT NULL DEFAULT '{}';
```

`PipelineSettings` gains `generationPrompts?: { image?: string; video?: string }`. The repo
`get`/`put` read/write the new column (symmetric with `generation_profiles`):
`put(projectId, steps, generationProfiles = {}, generationPrompts = {})`. The
`/pipeline-settings` route body + `updatePipelineSettings` extend symmetrically.

### 5. Dialog tabs

[pipeline-settings-dialog.tsx](../../../packages/frontend/src/pages/content-studio/pipeline-settings-dialog.tsx):

- `STEP_TABS` → add `{ key: 'image', label: 'Image' }`, `{ key: 'video', label: 'Video' }`.
  The tab key type becomes `PipelineAiStep | 'image' | 'video'`.
- The scroll area renders by tab kind:
  - **AI-step tabs** (`brief`/`refine`/`ai_review`): unchanged (prompt + model/effort/temp/
    JSON-attempts).
  - **Media tabs** (`image`/`video`): a single `ProfilePicker` for that media type (Manual /
    Flow [image only] / agent profiles) + a generation-prompt `<textarea>` with the media's
    placeholder hint, "Edit from default" (loads `DEFAULT_GENERATION_TEMPLATES[type]`) and
    "Reset to default" (clears that media type's prompt override). Remove the bottom "Media
    generation" block.
- Dialog state gains `genPrompts: { image?: string; video?: string }`, initialized from
  `settings.generationPrompts ?? {}`; `genProfiles` stays. `save()` calls
  `updatePipelineSettings(projectId, clean(steps), genProfiles, cleanPrompts(genPrompts))`.
- The profile defaults shipped via `getPipelineSettings` response also include the new
  generation defaults so the media-tab placeholder can show them — extend the GET to return
  `generationDefaults: DEFAULT_GENERATION_TEMPLATES` alongside `defaults`.
- A small `MediaProfilePicker` is added to
  [generation-profile-picker.tsx](../../../packages/frontend/src/pages/content-studio/generation-profile-picker.tsx)
  (or the existing one is parameterized) to render a single media type's picker; the old
  dual `GenerationProfilePicker` is replaced by per-tab usage.

## Components & boundaries

| Unit | Responsibility | Change |
| --- | --- | --- |
| migration 035 | add `generation_prompts` column | Create |
| `shared/PipelineSettings` | + `generationPrompts?` | Modify |
| `shared/GenerationPromptDefaults` | new defaults type | Create |
| `ContentPipelineSettingsRepo` | read/write column | get/put 4th arg |
| `pipeline-settings.ts` route | body + put + GET defaults | Modify |
| `prompts.ts` | `DEFAULT_GENERATION_TEMPLATES` + vars | Modify |
| `derive-tasks.ts` | render template (replaces buildImagePrompt) | Modify |
| `generation-service.ts` | `getGenerationPrompts` dep | Modify |
| `factory.ts` | wire prompts dep | Modify |
| `api.ts` | `updatePipelineSettings` + GET defaults | Modify |
| `pipeline-settings-dialog.tsx` | Image/Video tabs, per-kind render | Modify |
| `generation-profile-picker.tsx` | single-media picker | Modify |

## Testing

- **Repo**: `put`/`get` round-trips `generationPrompts`; independent of steps/profiles.
- **Route**: PUT persists `generationPrompts`; GET returns it + `generationDefaults`.
- **deriveTasks**: a custom image template renders with vars; carousel renders per slide
  with `{{slide}}`; custom video template renders `{{videoScript}}`; unset → default
  template (output still contains the subject/style/script).
- **prompts**: `renderGenerationPrompt` with a full visualBrief contains the subject + slide.
- **Frontend**: dialog shows Image/Video tabs; each renders a picker + prompt textarea;
  editing the prompt + Save calls `updatePipelineSettings` with `generationPrompts`;
  "Reset to default" clears the media prompt.

## Out of scope / non-goals

- Per-item (vs per-project) generation prompt/profile overrides.
- Model/effort/temperature controls on media tabs.
- A global layer for generation prompts (profiles keep their global layer; prompts don't).
- Uploading manually-generated files back into the draft.

## Migration / behavior note

Replacing `buildImagePrompt`'s `'. '`-joined composition with a newline template render
changes the exact prompt string (content-equivalent). Existing users with no custom template
get the default template render. This is intentional and the basis for editability.
