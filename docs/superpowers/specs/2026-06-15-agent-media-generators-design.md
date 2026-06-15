# AI-agent image & video generators + profile config — Design

Date: 2026-06-15
Status: Approved (pending spec review)

## Problem

Content Studio's generation phase turns refined content into draft assets. Today:
- **Image / carousel** tasks generate via **Google Flow** (`FlowImageGenerator`, headed
  Chrome on the `flow` profile).
- **Video** tasks are created but left `status: 'manual'` — there is no video generator.
- There is **no config** to choose how images/videos are generated.

We want:
1. **Config to pick an AI-agent profile** for image generation and for video generation.
2. **Image generation via an AI agent** — specifically a Codex profile using Codex CLI's
   native image generation (`$imagegen`, gpt-image-2). Google Flow stays available as an
   alternative, chosen per the configured image profile. When no image profile is set,
   default to a built-in Codex image profile.
3. **Video generation via HyperFrames** — HeyGen's open-source npm package
   (`hyperframes`) that an agent drives by writing HTML scenes + a Node render script,
   producing a deterministic MP4 (headless Chromium + FFmpeg). The video profile is
   configurable; when unset, default to a built-in Codex video profile.

## Research findings (external mechanisms)

- **Codex native image generation:** Codex CLI generates/edits images directly when the
  prompt includes `$imagegen` (model gpt-image-2); files are written into the working
  dir. Counts toward Codex usage; `OPENAI_API_KEY` enables API-priced batches.
  (developers.openai.com/codex/cli/features)
- **HyperFrames:** open-source npm package (`npm install hyperframes`, Node 18+). An
  agent writes HTML/CSS/JS scene files + a Node script that imports `hyperframes` and
  renders frames via headless Chromium, compiled to MP4 with FFmpeg. Deterministic;
  designed for AI agents (documented Claude Code workflow). (hyperframes.app,
  mindstudio.ai)

Both are **agent-driven**: run a configured profile in the item's asset dir, let it
produce the file(s), then collect them. This unifies image + video behind one mechanism.

## Current state (verified)

- `packages/backend/src/content-generation/`:
  - `generators.ts` — `Generator` interface (`generate(task, ctx) → GenerationOutput`),
    `GeneratorRegistry` (capability → generator), `TextGenerator`, `FlowImageGenerator`.
  - `generation-service.ts` — `runTask` looks up `registry.get(task.capability)`; if none,
    sets `manual`. Retries up to `maxRetries`, writes a failure lesson, then `finalize`
    stitches the draft.
  - `derive-tasks.ts` — `deriveTasks` maps refined content → task specs. `video` is
    currently `spec('video', …, 'manual')`.
  - `factory.ts` — builds the registry: `[TextGenerator, FlowImageGenerator]`; provides
    `assetDirFor(contentId) = <dataDir>/content-pipeline/<id>/assets`.
- `GenerationCapability = 'text' | 'image' | 'video' | 'audio' | 'voiceover'` (shared).
- `GenerateCtx = { contentId, assetDir }` (generators run against `ctx.assetDir`).
- **Profiles** (`packages/conversation/src/profiles/builtin.ts`): static `Profile[]` with
  `config.agent` (claude/codex/antigravity/qoder/gpt-web/qwen-web) + model/permissions.
- **AppConfig** (`packages/shared`): already carries `pipelineStepProfiles?` and
  `contextInjectionProfileId?`. `config.ts` `PatchBody` validates each field; the patch is
  a shallow merge persisted to `{dataDir}/config.json`.
- **Profile→agent run plumbing** lives inline in the content-pipeline
  `factory.ts` `runAgent` dep (~lines 108-162): resolve profile id → `stack.profiles.resolve`,
  reject web agents, check `stack.profileHomes.for(id, agent).hasCredentials()`, inject
  `home.env()` + profile env, pick model, call `agentService.runAgent`, return text.
- **UI:** `content-studio.tsx` loads `cfg.pipelineStepProfiles`, renders `StepProfilePicker`
  (which wraps the shared `ProfilePicker`), and persists changes via `updateAppConfig`.

## Decisions (from brainstorming)

1. **Scope:** config + generators wired end-to-end.
2. **Image:** codex native image output (`$imagegen`); **keep Google Flow too**, chosen by
   the configured image profile. Unset image profile → default built-in `codex-image`.
3. **Video:** HyperFrames via an agent; **default to a built-in `codex-video`** profile
   when unset.

## Design

### 1. Config — `generationProfiles`

Shared (`packages/shared/src/index.ts`):

```ts
export interface GenerationProfileConfig {
  /** Profile id, or the reserved 'google-flow' value, for image generation. */
  image?: string
  /** Profile id for video (HyperFrames) generation. */
  video?: string
}
// AppConfig:  generationProfiles?: GenerationProfileConfig
```

`config.ts` `PatchBody`: add

```ts
const GenerationProfilesSchema = z.object({
  image: z.string().optional(),
  video: z.string().optional(),
}).strict()
// generationProfiles: GenerationProfilesSchema.optional(),
```

Reserved constant `FLOW_IMAGE_PROFILE_ID = 'google-flow'` (exported from the generators
module) marks "use Google Flow" in the image picker.

### 2. Default built-in profiles (`builtin.ts`)

Two permissive Codex profiles (they must run `$imagegen` / `npm install` + node + ffmpeg
and write files without prompts):

```ts
{ id: 'codex-image', name: 'Codex — Image Generator',
  description: 'Codex with native image generation ($imagegen) for content image assets.',
  source: 'builtin',
  config: { agent: 'codex', model: 'gpt-5.4', sandboxMode: 'danger-full-access',
            approvalPolicy: 'never', reasoningEffort: 'low' },
  sortOrder: 150, createdAt: 0, updatedAt: 0 },
{ id: 'codex-video', name: 'Codex — Video Generator (HyperFrames)',
  description: 'Codex driving the hyperframes npm package to render MP4 video assets.',
  source: 'builtin',
  config: { agent: 'codex', model: 'gpt-5.4', sandboxMode: 'danger-full-access',
            approvalPolicy: 'never', reasoningEffort: 'low' },
  sortOrder: 151, createdAt: 0, updatedAt: 0 },
```

### 3. Shared agent-runner (`agent-run.ts`)

Extract the inline profile→agent logic from content-pipeline `factory.ts` into a shared
`packages/backend/src/agent-run.ts`:

```ts
export interface RunProfileAgentInput {
  profileId?: string
  prompt: string
  cwd: string            // absolute working dir (agent runs here)
  files?: string[]
  model?: string
  reasoningEffort?: ReasoningEffort
  temperature?: number
  workspaceId?: string
  onProgress?: (message: string) => void
}
export async function runProfileAgent(
  stack: ConversationStack, dataDir: string, agentService: AiAgentService,
  input: RunProfileAgentInput,
): Promise<{ text: string; agent: AgentKind }>
```

It performs the existing resolution (profile → agent, reject web agents, credential check,
env injection, model selection, run + stream-or-not). The content-pipeline `factory.ts`
`runAgent` dep is refactored to call this (behavior identical; the pipeline keeps its
`resolveProfileId` default chain by passing the already-resolved id). The new generators
call it directly.

> The content-pipeline `resolveProfileId`/`resolveAgentKind` default chain stays in
> `factory.ts`; `runProfileAgent` takes an explicit `profileId` (caller resolves defaults).

### 4. Generators

`AgentGenerator` base (`generators.ts` or a new `agent-generators.ts`):

```ts
interface AgentGeneratorDeps {
  getConfig: () => AppConfig
  getDataDir: () => string
  runAgent: (input: RunProfileAgentInput) => Promise<{ text: string; agent: AgentKind }>
}
```

`generate(task, ctx)`:
1. `mkdirSync(ctx.assetDir, { recursive: true })`.
2. Snapshot existing file names in `ctx.assetDir`.
3. Resolve the profile id (capability-specific, see below).
4. Build the capability prompt (below) and `runAgent({ profileId, prompt, cwd: ctx.assetDir })`.
5. Re-scan `ctx.assetDir`; new files whose extension matches the capability's set are the
   outputs. Throw if none produced.
6. Return `{ assetPaths: newFiles, meta: { agent, profileId } }`.

Two concrete generators:

- **`ConfigurableImageGenerator`** (capability `image`): resolves
  `cfg.generationProfiles?.image`:
  - `=== FLOW_IMAGE_PROFILE_ID` → delegate to the existing `FlowImageGenerator`.
  - any other id → agent run with that profile.
  - unset → agent run with `'codex-image'`.
  Image extensions: `.png .jpg .jpeg .webp`. Prompt: instruct the agent to generate the
  image described by `task.inputPrompt` using `$imagegen`, saving exactly one file into the
  current directory; reply with the filename only.
- **`AgentVideoGenerator`** (capability `video`): profile = `cfg.generationProfiles?.video
  ?? 'codex-video'`. Video extension: `.mp4`. Prompt: instruct the agent to (a) ensure
  `hyperframes` is installed (`npm install hyperframes` if missing), (b) write HTML
  scene(s) + a Node render script realizing `task.inputPrompt` (the video script / visual
  brief), (c) run it to produce one `.mp4` in the current directory, (d) reply with the
  filename only.

Registry (`factory.ts`): `[TextGenerator, new ConfigurableImageGenerator({...}),
new AgentVideoGenerator({...})]`. `FlowImageGenerator` stays constructed and is held by
`ConfigurableImageGenerator` for the Flow branch — it is no longer registered directly.

### 5. Task derivation (`derive-tasks.ts`)

`video` task becomes `spec('video', refined.copywriting.videoScript ?? refined.visualBrief.concept)`
(default status `pending`) so the video generator runs. `voiceover` stays `manual` (out of
scope). Image/carousel tasks are unchanged (capability `image`).

### 6. UI — generation profile picker

New `GenerationProfilePicker` (`content-studio/generation-profile-picker.tsx`) reusing the
shared `ProfilePicker`:
- **Image** dropdown: the agent profiles (excluding gpt-web/qwen-web, which can't run
  headless image/agent steps) **plus** a synthetic "Google Flow (browser)" option whose id
  is `FLOW_IMAGE_PROFILE_ID`.
- **Video** dropdown: agent profiles only (excluding web agents).
Wired in `content-studio.tsx` next to `StepProfilePicker`; reads `cfg.generationProfiles`,
writes via `updateAppConfig({ generationProfiles: next })`.

### 7. Error handling & runtime caveats

- Agent throws, or no matching output file is produced → `generate` throws → existing
  `runTask` retry (`maxRetries`) + failure-lesson path applies.
- Missing profile credentials / web-agent profile → `runProfileAgent` throws a clear,
  actionable error (reused from the pipeline path).
- **Runtime dependencies the app cannot guarantee** (documented, not enforced): the Codex
  CLI must have image generation available; the video profile's host needs Node + npm +
  FFmpeg for hyperframes. The first video run does `npm install hyperframes` in the asset
  workspace. No third-party dep is added to the app itself → no root `package.json` /
  packaging change.

### 8. Testing

- `agent-run.ts`: a focused unit test that profile resolution + the run input are built
  correctly (inject a fake `agentService`), and web-agent / missing-credential errors throw.
- `AgentGenerator` (image + video): inject a fake `runAgent` that writes a fake output file
  into `ctx.assetDir`; assert the new file is collected, that "no output" throws, and that
  the image generator routes to Flow when the profile is `google-flow`.
- `derive-tasks`: video task is now `pending`.
- config route: `generationProfiles` round-trips through PATCH/GET.
- Keep existing content-generation + content-pipeline + ai-agent suites green (rebuild
  `@anubis/shared` → `@anubis/conversation` → `@anubis/ai-agent` → `@anubis/backend`).

## Out of scope (YAGNI)

- `audio` / `voiceover` generators (stay manual).
- Per-project (vs per-machine) generation profiles — page-level like `pipelineStepProfiles`.
- Bundling/installing hyperframes, Node, or FFmpeg for the user.
- A settings-page surface beyond the Content Studio picker.
- Editing/iterating generated assets.

## Packaging note

No new runtime third-party import in the app (generators use `node:fs` + the existing
ai-agent service). hyperframes is installed at runtime by the agent inside the asset
workspace, so the electron-builder root-deps rule does not apply.
