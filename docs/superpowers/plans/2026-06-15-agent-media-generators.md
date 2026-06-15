# AI-agent image & video generators + profile config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add config to pick image/video generation profiles, generate images via a Codex AI-agent profile (`$imagegen`, with Google Flow kept as a selectable option) and videos via an agent driving the `hyperframes` npm package.

**Architecture:** Both new generators run a configured agent profile in the item's asset dir via a shared `runProfileAgent` helper (extracted from the content-pipeline factory), then collect the new files the agent produced. A new `generationProfiles` AppConfig field + a Content Studio picker choose the profiles; two permissive built-in Codex profiles are the defaults.

**Tech Stack:** TypeScript (ESM) monorepo, Hono backend, React 19 frontend, Vitest, `@anubis/ai-agent` (Codex/Claude/etc. CLI agents).

---

## Background the implementer needs

- **Build order** (vitest resolves `@anubis/*` to `dist`): rebuild a changed package before tests that depend on it. Order here: `@anubis/shared` → `@anubis/conversation` → `@anubis/ai-agent` → `@anubis/backend` → `@anubis/frontend`. Commands: `pnpm --filter @anubis/<pkg> build`.
- **Backend tests:** `pnpm vitest run <path> --maxWorkers=2` (the full suite flakes under load).
- **Frontend tests:** `cd packages/frontend && pnpm vitest run`.
- **Typecheck:** `pnpm typecheck` (root).
- Branch `feat/agent-media-generators` is checked out (spec committed there).

Verified facts:
- Generators implement `Generator { name; capability; generate(task, ctx) → GenerationOutput }`; `ctx = { contentId, assetDir }`. Registry maps capability → one generator (`generators.ts`). `generation-service.ts` `runTask` → `registry.get(task.capability)`; if none → `manual`; retries `maxRetries`; failure → lesson.
- `GenerationOutput = { text?; assetPaths?; meta? }`.
- `deriveTasks` (`derive-tasks.ts`) currently emits `video` as `'manual'`.
- Content-pipeline `factory.ts` `runAgent` dep (lines ~109-199) holds the only profile→agent run logic: `resolveProfileId` → `stack.profiles.resolve` → reject `WEB_AGENTS` → `stack.profileHomes.for(id,agent).hasCredentials()` → build input (model precedence, permissive sandbox/approval/permission defaults, `extraEnv: {...home.env(), ...resolved.env}`, `qoderApiKey`) → `agentService.runAgent`/`streamAgent`. `eventToProgressMessage` is a local helper there.
- `ResolvedProfile = ProfileConfig & { agent }` (has `agent`, `model`, `sandboxMode`, `approvalPolicy`, `permissionMode`, `allowedTools`, `disallowedTools`, `claudeCliProfile`, `env`, `reasoningEffort`).
- `AppConfig` already has `pipelineStepProfiles?` + `contextInjectionProfileId?`; `config.ts` `PatchBody` validates each field (`.strict()`); patch is a shallow merge.
- `ai-agent.ts` has a private `getAiAgentService()` returning a `qoderApiKey`-aware singleton.
- UI: `content-studio.tsx` loads `cfg.pipelineStepProfiles`, renders `StepProfilePicker` (wraps shared `ProfilePicker`), persists via debounced `updateAppConfig`. `listProfiles()` → `ProfileSummary[]`.
- Asset dir: `assetDirFor(contentId) = <dataDir>/content-pipeline/<id>/assets`.

---

## Task 1: Shared `GenerationProfileConfig` + `AppConfig.generationProfiles`

**Files:**
- Modify: `packages/shared/src/index.ts` (near `PipelineStepProfileConfig` and `AppConfig`)

- [ ] **Step 1: Add the type + AppConfig field**

After `export interface PipelineStepProfileConfig { … }` add:

```ts
export interface GenerationProfileConfig {
  /** Profile id, or the reserved 'google-flow' value, for image generation. */
  image?: string
  /** Profile id for video (HyperFrames) generation. */
  video?: string
}
```

Inside `AppConfig`, after the `pipelineStepProfiles?` line add:

```ts
  /** AI profile assignments for Content Studio generation (image / video). */
  generationProfiles?: GenerationProfileConfig
```

- [ ] **Step 2: Build shared**

Run: `pnpm --filter @anubis/shared build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): GenerationProfileConfig + AppConfig.generationProfiles"
```

---

## Task 2: Config route accepts `generationProfiles`

**Files:**
- Modify: `packages/backend/src/config.ts`
- Modify: `packages/backend/tests/config-route.test.ts`

- [ ] **Step 1: Add a failing test**

Append inside the `describe('/config route', …)` block in `config-route.test.ts`:

```ts
  it('PATCH /config round-trips generationProfiles', async () => {
    const { default: app } = await import('../src/app.js')
    const patch = await app.request('/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ generationProfiles: { image: 'codex-image', video: 'codex-video' } }),
    })
    expect(patch.status).toBe(200)
    const get = await app.request('/config')
    const body = (await get.json()) as { config: { generationProfiles?: { image?: string; video?: string } } }
    expect(body.config.generationProfiles).toEqual({ image: 'codex-image', video: 'codex-video' })
  })
```

- [ ] **Step 2: Run it (expect fail)**

Run: `pnpm vitest run packages/backend/tests/config-route.test.ts --maxWorkers=2`
Expected: FAIL — `generationProfiles` stripped by `.strict()` PatchBody (not persisted).

- [ ] **Step 3: Add the schema + field**

In `config.ts`, after `StepProfilesSchema`:

```ts
const GenerationProfilesSchema = z.object({
  image: z.string().optional(),
  video: z.string().optional(),
}).strict()
```

In `PatchBody`, after the `pipelineStepProfiles` line:

```ts
  generationProfiles: GenerationProfilesSchema.optional(),
```

- [ ] **Step 4: Run it (expect pass)**

Run: `pnpm vitest run packages/backend/tests/config-route.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/config.ts packages/backend/tests/config-route.test.ts
git commit -m "feat(config): accept generationProfiles (image/video)"
```

---

## Task 3: Built-in `codex-image` + `codex-video` profiles

**Files:**
- Modify: `packages/conversation/src/profiles/builtin.ts`
- Modify or create: a builtin-profiles test (check `packages/conversation/tests` for an existing one first)

- [ ] **Step 1: Add the two profiles**

In `builtin.ts`, append to the `BUILTIN_PROFILES` array (after `qoder-performance`):

```ts
  {
    id: 'codex-image',
    name: 'Codex — Image Generator',
    description: 'Codex with native image generation ($imagegen) for content image assets.',
    source: 'builtin',
    config: {
      agent: 'codex',
      model: 'gpt-5.4',
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never',
      reasoningEffort: 'low',
    },
    sortOrder: 150,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'codex-video',
    name: 'Codex — Video Generator (HyperFrames)',
    description: 'Codex driving the hyperframes npm package to render MP4 video assets.',
    source: 'builtin',
    config: {
      agent: 'codex',
      model: 'gpt-5.4',
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never',
      reasoningEffort: 'low',
    },
    sortOrder: 151,
    createdAt: NOW,
    updatedAt: NOW,
  },
```

- [ ] **Step 2: Guard test (find or add)**

Run: `ls packages/conversation/tests` and `grep -rl "BUILTIN_PROFILES\|codex-coding" packages/conversation/tests` to find an existing builtin test.

- If one exists, add an assertion there:

```ts
  it('includes the codex media-generation profiles', () => {
    const ids = BUILTIN_PROFILES.map((p) => p.id)
    expect(ids).toContain('codex-image')
    expect(ids).toContain('codex-video')
    expect(BUILTIN_PROFILES.find((p) => p.id === 'codex-image')!.config.agent).toBe('codex')
  })
```

- If none exists, create `packages/conversation/tests/profiles/builtin.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { BUILTIN_PROFILES } from '../../src/profiles/builtin.js'

describe('BUILTIN_PROFILES', () => {
  it('includes the codex media-generation profiles', () => {
    const ids = BUILTIN_PROFILES.map((p) => p.id)
    expect(ids).toContain('codex-image')
    expect(ids).toContain('codex-video')
    expect(BUILTIN_PROFILES.find((p) => p.id === 'codex-image')!.config.agent).toBe('codex')
  })
})
```

- [ ] **Step 3: Run the test + build**

Run: `pnpm vitest run packages/conversation/tests/profiles/builtin.test.ts` (or the existing path)
Expected: PASS.
Run: `pnpm --filter @anubis/conversation build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/conversation/src/profiles/builtin.ts packages/conversation/tests/
git commit -m "feat(profiles): codex-image + codex-video builtin generation profiles"
```

---

## Task 4: Shared `runProfileAgent` helper + refactor pipeline factory

**Files:**
- Create: `packages/backend/src/agent-run.ts`
- Create: `packages/backend/tests/agent-run.test.ts`
- Modify: `packages/backend/src/content-pipeline/factory.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/agent-run.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { runProfileAgent } from '../src/agent-run.js'

function fakeStack(over: Record<string, unknown> = {}) {
  return {
    profiles: { resolve: vi.fn(() => ({ agent: 'codex', model: 'gpt-5.4' })) },
    profileHomes: { for: vi.fn(() => ({ hasCredentials: () => true, env: () => ({ CODEX_HOME: '/h' }) })) },
    appConfig: { get: () => ({ qoderApiKey: undefined }) },
    ...over,
  } as never
}

describe('runProfileAgent', () => {
  it('resolves the profile and runs the agent, returning text + agent', async () => {
    const agentService = { runAgent: vi.fn(async () => ({ text: 'ok' })) } as never
    const res = await runProfileAgent(fakeStack(), agentService, { profileId: 'codex-image', prompt: 'hi', cwd: process.cwd() })
    expect(res).toEqual({ text: 'ok', agent: 'codex' })
    const input = (agentService as { runAgent: { mock: { calls: unknown[][] } } }).runAgent.mock.calls[0]![0] as Record<string, unknown>
    expect(input.agent).toBe('codex')
    expect(input.model).toBe('gpt-5.4')
    expect(input.approvalPolicy).toBe('never')
  })

  it('rejects a web-agent profile', async () => {
    const stack = fakeStack({ profiles: { resolve: vi.fn(() => ({ agent: 'gpt-web' })) } })
    const agentService = { runAgent: vi.fn() } as never
    await expect(runProfileAgent(stack, agentService, { profileId: 'gpt-web-default', prompt: 'x', cwd: process.cwd() }))
      .rejects.toThrow(/web agent/i)
  })

  it('rejects a profile with no credentials', async () => {
    const stack = fakeStack({ profileHomes: { for: vi.fn(() => ({ hasCredentials: () => false, env: () => ({}) })) } })
    const agentService = { runAgent: vi.fn() } as never
    await expect(runProfileAgent(stack, agentService, { profileId: 'codex-image', prompt: 'x', cwd: process.cwd() }))
      .rejects.toThrow(/credentials/i)
  })
})
```

- [ ] **Step 2: Run it (expect fail)**

Run: `pnpm vitest run packages/backend/tests/agent-run.test.ts --maxWorkers=2`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `agent-run.ts`**

Create `packages/backend/src/agent-run.ts`:

```ts
import { mkdirSync } from 'node:fs'
import type { AgentEvent, AiAgentService } from '@anubis/ai-agent'
import type { ConversationStack } from '@anubis/conversation'
import type { AgentKind, ReasoningEffort } from '@anubis/shared'

/** Web agents drive a browser session and cannot run headless agent steps. */
export const WEB_AGENTS = new Set<AgentKind>(['gpt-web', 'qwen-web'])

export function eventToProgressMessage(event: AgentEvent): string | null {
  switch (event.type) {
    case 'partial':
      return 'Agent is thinking…'
    case 'tool_call': {
      const name = (event.data as { toolName?: string }).toolName ?? 'tool'
      return `Using tool: ${name}…`
    }
    case 'tool_result':
      return 'Tool returned a result.'
    case 'approval_required': {
      const name = (event.data as { toolName?: string }).toolName ?? 'tool'
      return `Waiting for approval: ${name}`
    }
    case 'session':
      return 'Agent session started.'
    case 'done':
      return 'Agent finished.'
    default:
      return null
  }
}

export interface RunProfileAgentInput {
  /** A fully-resolved profile id (caller resolves any default chain). */
  profileId: string
  prompt: string
  /** Absolute working dir; the agent runs here. Created if missing. */
  cwd: string
  files?: string[]
  /** Model override; falls back to the profile's own config.model. */
  model?: string
  reasoningEffort?: ReasoningEffort
  temperature?: number
  workspaceId?: string
  onProgress?: (message: string) => void
}

/**
 * Resolve a profile to its agent and run a one-shot turn in `cwd`. Shared by the
 * content pipeline and the content-generation agent generators. Rejects web
 * agents and unauthenticated profiles with actionable errors.
 */
export async function runProfileAgent(
  stack: ConversationStack,
  agentService: AiAgentService,
  input: RunProfileAgentInput,
): Promise<{ text: string; agent: AgentKind }> {
  mkdirSync(input.cwd, { recursive: true })
  const resolved = stack.profiles.resolve(input.profileId)
  const agent = resolved.agent
  if (WEB_AGENTS.has(agent)) {
    throw new Error(
      `Profile "${input.profileId}" uses the web agent "${agent}", which can't run headless agent steps. `
      + 'Pick a CLI/SDK profile (Claude, Codex, Antigravity, or Qoder).',
    )
  }
  const home = stack.profileHomes.for(input.profileId, agent)
  if (!home.hasCredentials()) {
    throw new Error(
      `Profile "${input.profileId}" (${agent}) has no credentials. `
      + 'Open Profiles, sign in to the profile, then retry.',
    )
  }
  const cfg = stack.appConfig.get()
  const runInput = {
    agent,
    cwd: input.cwd,
    prompt: input.prompt,
    files: input.files,
    model: input.model ?? resolved.model,
    reasoningEffort: input.reasoningEffort ?? resolved.reasoningEffort,
    temperature: input.temperature,
    sandboxMode: resolved.sandboxMode ?? 'workspace-write' as const,
    approvalPolicy: resolved.approvalPolicy ?? 'never' as const,
    permissionMode: resolved.permissionMode ?? 'bypassPermissions' as const,
    allowedTools: resolved.allowedTools,
    disallowedTools: resolved.disallowedTools,
    claudeCliProfile: resolved.claudeCliProfile,
    workspaceId: input.workspaceId,
    extraEnv: { ...home.env(), ...(resolved.env ?? {}) },
    qoderApiKey: cfg.qoderApiKey,
  }

  if (!input.onProgress) {
    const res = await agentService.runAgent(runInput)
    return { text: res.text, agent }
  }

  const onProgress = input.onProgress
  const { stream } = await agentService.streamAgent(runInput)
  let text = ''
  return new Promise<{ text: string; agent: AgentKind }>((resolve, reject) => {
    stream.on('partial', (data) => {
      text += data.deltaText ?? ''
      const m = eventToProgressMessage({ type: 'partial', data })
      if (m) onProgress(m)
    })
    stream.on('tool_call', (data) => { const m = eventToProgressMessage({ type: 'tool_call', data }); if (m) onProgress(m) })
    stream.on('tool_result', (data) => { const m = eventToProgressMessage({ type: 'tool_result', data }); if (m) onProgress(m) })
    stream.on('approval_required', (data) => { const m = eventToProgressMessage({ type: 'approval_required', data }); if (m) onProgress(m) })
    stream.on('session', (data) => { const m = eventToProgressMessage({ type: 'session', data }); if (m) onProgress(m) })
    stream.on('done', () => { onProgress('Agent finished.'); resolve({ text, agent }) })
    stream.on('error', ({ error }) => reject(error))
  })
}
```

- [ ] **Step 4: Run it (expect pass)**

Run: `pnpm vitest run packages/backend/tests/agent-run.test.ts --maxWorkers=2`
Expected: PASS (3 tests).

- [ ] **Step 5: Refactor `factory.ts` to use the helper**

In `content-pipeline/factory.ts`:

1. Remove the local `eventToProgressMessage` function (lines ~10-31) and the local `WEB_AGENTS` constant (line ~50).
2. Update imports: drop `mkdirSync` if now unused elsewhere (it is used only for `workDir` — remove it), keep `join`. Add:

```ts
import { runProfileAgent, WEB_AGENTS } from '../agent-run.js'
```

(Keep `import { createAiAgentService, type AgentEvent } from '@anubis/ai-agent'` only if `AgentEvent` is still referenced — after removing the local `eventToProgressMessage` it is not, so change it to `import { createAiAgentService } from '@anubis/ai-agent'`.)

3. Replace the entire `runAgent:` dep body (lines ~109-199) with:

```ts
    runAgent: async ({ prompt, cwd, projectId, step, profileId, model: stepModel, reasoningEffort: stepEffort, temperature, files, onProgress }) => {
      const workDir = join(dataDir, 'content-pipeline', cwd.split('/').pop() ?? 'scratch')
      // Resolve the profile (default chain) + its agent, then the step model.
      const resolvedId = resolveProfileId(stack, profileId)
      const resolved = stack.profiles.resolve(resolvedId)
      const model = stepModel ?? resolved.model ?? (step === 'ai_review' && resolved.agent === 'claude' ? REVIEW_MODEL : undefined)
      const res = await runProfileAgent(stack, agentService, {
        profileId: resolvedId,
        prompt,
        cwd: workDir,
        files,
        model,
        reasoningEffort: stepEffort,
        temperature,
        workspaceId: projectId,
        onProgress,
      })
      return res.text
    },
```

`WEB_AGENTS` is still referenced by `resolveProfileId`/`resolveAgentKind` — it now comes from the `agent-run.js` import, so the local definition is gone but usages still resolve.

- [ ] **Step 6: Verify the pipeline path is unbroken**

Run: `pnpm --filter @anubis/backend build`
Expected: clean.
Run: `pnpm vitest run packages/backend/tests/content-pipeline packages/backend/tests/content-pipeline-routes.test.ts --maxWorkers=2`
Expected: all PASS (unchanged behavior).

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/agent-run.ts packages/backend/tests/agent-run.test.ts packages/backend/src/content-pipeline/factory.ts
git commit -m "refactor(backend): extract shared runProfileAgent; pipeline factory uses it"
```

---

## Task 5: Agent image + video generators

**Files:**
- Create: `packages/backend/src/content-generation/agent-generators.ts`
- Create: `packages/backend/tests/content-generation/agent-generators.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/content-generation/agent-generators.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AppConfig, GenerationTask } from '@anubis/shared'
import {
  AgentVideoGenerator, ConfigurableImageGenerator, FLOW_IMAGE_PROFILE_ID,
} from '../../src/content-generation/agent-generators.js'

const task = (over: Partial<GenerationTask> = {}): GenerationTask => ({
  id: 't1', contentId: 'c1', projectId: 'default', type: 'image', capability: 'image',
  generator: '', inputPrompt: 'a red cat', status: 'pending', retryCount: 0, createdAt: 1, updatedAt: 1, ...over,
})

function ctx() {
  return { contentId: 'c1', assetDir: join(mkdtempSync(join(tmpdir(), 'anubis-gen-')), 'assets') }
}

describe('ConfigurableImageGenerator', () => {
  it('runs the agent and collects the produced image file', async () => {
    const runAgent = vi.fn(async ({ cwd }: { cwd: string }) => {
      writeFileSync(join(cwd, 'out.png'), 'img')
      return { text: 'out.png', agent: 'codex' as const }
    })
    const gen = new ConfigurableImageGenerator({
      getConfig: () => ({} as AppConfig), runAgent, flow: { generate: vi.fn() } as never,
    })
    const out = await gen.generate(task(), ctx())
    expect(out.assetPaths!.length).toBe(1)
    expect(out.assetPaths![0]!.endsWith('out.png')).toBe(true)
    const input = runAgent.mock.calls[0]![0] as { profileId: string; prompt: string }
    expect(input.profileId).toBe('codex-image') // default when unset
    expect(input.prompt).toContain('$imagegen')
  })

  it('delegates to Google Flow when the image profile is google-flow', async () => {
    const flowGenerate = vi.fn(async () => ({ assetPaths: ['/x/flow.png'] }))
    const runAgent = vi.fn()
    const gen = new ConfigurableImageGenerator({
      getConfig: () => ({ generationProfiles: { image: FLOW_IMAGE_PROFILE_ID } } as AppConfig),
      runAgent, flow: { generate: flowGenerate } as never,
    })
    const out = await gen.generate(task(), ctx())
    expect(flowGenerate).toHaveBeenCalled()
    expect(runAgent).not.toHaveBeenCalled()
    expect(out.assetPaths).toEqual(['/x/flow.png'])
  })

  it('throws when the agent produces no image file', async () => {
    const runAgent = vi.fn(async () => ({ text: 'done', agent: 'codex' as const }))
    const gen = new ConfigurableImageGenerator({
      getConfig: () => ({} as AppConfig), runAgent, flow: { generate: vi.fn() } as never,
    })
    await expect(gen.generate(task(), ctx())).rejects.toThrow(/no .*image/i)
  })
})

describe('AgentVideoGenerator', () => {
  it('runs the agent and collects the produced mp4', async () => {
    const runAgent = vi.fn(async ({ cwd }: { cwd: string }) => {
      writeFileSync(join(cwd, 'reel.mp4'), 'vid')
      return { text: 'reel.mp4', agent: 'codex' as const }
    })
    const gen = new AgentVideoGenerator({ getConfig: () => ({} as AppConfig), runAgent })
    const out = await gen.generate(task({ type: 'video', capability: 'video', inputPrompt: 'a 5s promo' }), ctx())
    expect(out.assetPaths!.length).toBe(1)
    expect(out.assetPaths![0]!.endsWith('.mp4')).toBe(true)
    const input = runAgent.mock.calls[0]![0] as { profileId: string; prompt: string }
    expect(input.profileId).toBe('codex-video') // default when unset
    expect(input.prompt.toLowerCase()).toContain('hyperframes')
  })
})
```

- [ ] **Step 2: Run it (expect fail)**

Run: `pnpm vitest run packages/backend/tests/content-generation/agent-generators.test.ts --maxWorkers=2`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `agent-generators.ts`**

Create `packages/backend/src/content-generation/agent-generators.ts`:

```ts
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { AgentKind, AppConfig, GenerationCapability, GenerationOutput, GenerationTask } from '@anubis/shared'
import type { RunProfileAgentInput } from '../agent-run.js'
import type { GenerateCtx, Generator } from './generators.js'

/** Reserved image-profile value selecting the Google Flow browser generator. */
export const FLOW_IMAGE_PROFILE_ID = 'google-flow'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const VIDEO_EXTS = new Set(['.mp4'])

export type RunAgent = (input: RunProfileAgentInput) => Promise<{ text: string; agent: AgentKind }>

/** Files in `dir` whose extension is in `exts` (basenames). */
function snapshot(dir: string, exts: Set<string>): Set<string> {
  if (!existsSync(dir)) return new Set()
  return new Set(readdirSync(dir).filter((f) => exts.has(extname(f).toLowerCase())))
}

/**
 * Run a profile agent in the asset dir and return the asset files it newly
 * created (by extension). Throws if it produced none.
 */
async function generateViaAgent(
  runAgent: RunAgent, profileId: string, prompt: string, ctx: GenerateCtx,
  exts: Set<string>, kind: string,
): Promise<GenerationOutput> {
  mkdirSync(ctx.assetDir, { recursive: true })
  const before = snapshot(ctx.assetDir, exts)
  const { agent } = await runAgent({ profileId, prompt, cwd: ctx.assetDir })
  const after = snapshot(ctx.assetDir, exts)
  const created = [...after].filter((f) => !before.has(f))
  if (created.length === 0) {
    throw new Error(`Agent produced no ${kind} file in the asset dir.`)
  }
  return { assetPaths: created.map((f) => join(ctx.assetDir, f)), meta: { agent, profileId } }
}

function imagePrompt(brief: string): string {
  return [
    'You are generating ONE image asset for a social-media post, in the current working directory.',
    'Use Codex native image generation by including $imagegen, and SAVE the result as a single PNG or JPG file in the current directory.',
    '',
    '=== IMAGE BRIEF ===',
    brief,
    '',
    'When finished, reply with ONLY the saved image filename.',
  ].join('\n')
}

function videoPrompt(brief: string): string {
  return [
    'You are generating ONE short social-media video as a single .mp4 file in the current working directory,',
    'using the open-source "hyperframes" npm package (HeyGen).',
    'Steps:',
    '1. If hyperframes is not installed in the current directory, run: npm install hyperframes',
    '2. Write the HTML/CSS scene(s) and a Node script (render.js) that imports hyperframes and renders the scene(s) to a single MP4 here.',
    '3. Run it (e.g. node render.js) so a single .mp4 is produced in the current directory.',
    '',
    '=== VIDEO BRIEF / SCRIPT ===',
    brief,
    '',
    'When finished, reply with ONLY the produced .mp4 filename.',
  ].join('\n')
}

export interface ImageGeneratorDeps {
  getConfig: () => AppConfig
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
    const selected = this.deps.getConfig().generationProfiles?.image
    if (selected === FLOW_IMAGE_PROFILE_ID) {
      return this.deps.flow.generate(task, ctx)
    }
    const profileId = selected ?? 'codex-image'
    return generateViaAgent(this.deps.runAgent, profileId, imagePrompt(task.inputPrompt), ctx, IMAGE_EXTS, 'image')
  }
}

export interface VideoGeneratorDeps {
  getConfig: () => AppConfig
  runAgent: RunAgent
}

/** Video capability: an agent driving the hyperframes npm package → MP4. */
export class AgentVideoGenerator implements Generator {
  name = 'agent-video'
  capability: GenerationCapability = 'video'
  constructor(private readonly deps: VideoGeneratorDeps) {}

  async generate(task: GenerationTask, ctx: GenerateCtx): Promise<GenerationOutput> {
    const profileId = this.deps.getConfig().generationProfiles?.video ?? 'codex-video'
    return generateViaAgent(this.deps.runAgent, profileId, videoPrompt(task.inputPrompt), ctx, VIDEO_EXTS, 'video')
  }
}
```

- [ ] **Step 4: Run it (expect pass)**

Run: `pnpm vitest run packages/backend/tests/content-generation/agent-generators.test.ts --maxWorkers=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/content-generation/agent-generators.ts packages/backend/tests/content-generation/agent-generators.test.ts
git commit -m "feat(content-generation): codex image + hyperframes video agent generators"
```

---

## Task 6: `deriveTasks` — video is generatable

**Files:**
- Modify: `packages/backend/src/content-generation/derive-tasks.ts`
- Modify: `packages/backend/tests/content-generation/derive-tasks.test.ts`

- [ ] **Step 1: Update the test**

In `derive-tasks.test.ts`, change the video assertion (currently expects `'manual'`):

```ts
  it('video source → pending video task; videoScript → manual voiceover task', () => {
    const r = refined({ copywriting: { hook: 'h', body: 'b', cta: 'c', videoScript: 'read this' } })
    const tasks = deriveTasks(r, 'video')
    expect(tasks.find((t) => t.type === 'video')?.status).toBe('pending')
    expect(tasks.find((t) => t.type === 'voiceover')?.status).toBe('manual')
  })
```

- [ ] **Step 2: Run it (expect fail)**

Run: `pnpm vitest run packages/backend/tests/content-generation/derive-tasks.test.ts --maxWorkers=2`
Expected: FAIL — video status is still `'manual'`.

- [ ] **Step 3: Change the spec call**

In `derive-tasks.ts`, change the video line:

```ts
  if (mediaKind === 'video') tasks.push(spec('video', refined.copywriting.videoScript ?? refined.visualBrief.concept))
```

(drop the `'manual'` third arg so it defaults to `'pending'`; leave the `voiceover` line as `'manual'`.)

- [ ] **Step 4: Run it (expect pass)**

Run: `pnpm vitest run packages/backend/tests/content-generation/derive-tasks.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/content-generation/derive-tasks.ts packages/backend/tests/content-generation/derive-tasks.test.ts
git commit -m "feat(content-generation): video tasks are now generatable (pending, not manual)"
```

---

## Task 7: Wire the new generators into the registry

**Files:**
- Modify: `packages/backend/src/ai-agent.ts` (export `getAiAgentService`)
- Modify: `packages/backend/src/content-generation/factory.ts`

- [ ] **Step 1: Export the shared agent service**

In `ai-agent.ts`, change `function getAiAgentService()` to `export function getAiAgentService()`.

- [ ] **Step 2: Register the generators**

Replace `content-generation/factory.ts` contents with:

```ts
import { join } from 'node:path'
import { getDataDir, getStack } from '../services.js'
import { getAiAgentService } from '../ai-agent.js'
import { runProfileAgent } from '../agent-run.js'
import { GenerationService, type GenerationDeps } from './generation-service.js'
import { FlowImageGenerator, GeneratorRegistry, TextGenerator } from './generators.js'
import { AgentVideoGenerator, ConfigurableImageGenerator } from './agent-generators.js'

const MAX_RETRIES = 2

export function getGenerationService(): GenerationService {
  const stack = getStack()
  const getConfig = () => stack.appConfig.get()
  const runAgent = (input: Parameters<typeof runProfileAgent>[2]) =>
    runProfileAgent(stack, getAiAgentService(), input)

  const flow = new FlowImageGenerator({ getConfig, getDataDir })
  const registry = new GeneratorRegistry([
    new TextGenerator(),
    new ConfigurableImageGenerator({ getConfig, runAgent, flow }),
    new AgentVideoGenerator({ getConfig, runAgent }),
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

- [ ] **Step 3: Build the backend**

Run: `pnpm --filter @anubis/backend build`
Expected: clean. (If TS complains that `Parameters<typeof runProfileAgent>[2]` is awkward, import `RunProfileAgentInput` from `../agent-run.js` and type `runAgent` as `(input: RunProfileAgentInput) => …`.)

- [ ] **Step 4: Run the content-generation suites**

Run: `pnpm vitest run packages/backend/tests/content-generation --maxWorkers=2`
Expected: PASS (existing generation-service/stitch tests still green; the registry now also resolves `image`/`video`).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/ai-agent.ts packages/backend/src/content-generation/factory.ts
git commit -m "feat(content-generation): register agent image/video generators in the registry"
```

---

## Task 8: Frontend — generation profile picker

**Files:**
- Create: `packages/frontend/src/pages/content-studio/generation-profile-picker.tsx`
- Modify: `packages/frontend/src/pages/content-studio.tsx`

- [ ] **Step 1: Create the picker**

Create `packages/frontend/src/pages/content-studio/generation-profile-picker.tsx`:

```tsx
import { useMemo } from 'react'
import { ImageIcon, VideoIcon } from 'lucide-react'
import type { GenerationProfileConfig, ProfileSummary } from '@anubis/shared'
import { ProfilePicker } from '@/components/composer/profile-picker'

/** Must match FLOW_IMAGE_PROFILE_ID in the backend agent-generators module. */
const FLOW_IMAGE_PROFILE_ID = 'google-flow'

interface GenerationProfilePickerProps {
  profiles: ProfileSummary[]
  generationProfiles: GenerationProfileConfig
  onChange: (next: GenerationProfileConfig) => void
}

const FLOW_OPTION: ProfileSummary = {
  id: FLOW_IMAGE_PROFILE_ID,
  name: 'Google Flow (browser)',
  description: 'Generate images via Google Flow browser automation.',
  source: 'builtin',
  config: { agent: 'gpt-web' },
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
}

function resolveProfile(profiles: ProfileSummary[], id: string | undefined): ProfileSummary | null {
  if (!id) return null
  return profiles.find((p) => p.id === id) ?? null
}

export function GenerationProfilePicker({ profiles, generationProfiles, onChange }: GenerationProfilePickerProps) {
  // Agent profiles that can run headless generation (exclude web agents).
  const agentProfiles = useMemo(
    () => profiles.filter((p) => p.config.agent !== 'gpt-web' && p.config.agent !== 'qwen-web'),
    [profiles],
  )
  const imageProfiles = useMemo(() => [FLOW_OPTION, ...agentProfiles], [agentProfiles])

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
          profiles={agentProfiles}
          value={resolveProfile(agentProfiles, generationProfiles.video)}
          onChange={(p) => onChange({ ...generationProfiles, video: p.id })}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `content-studio.tsx`**

In `content-studio.tsx`:

1. Imports: add

```tsx
import { GenerationProfilePicker } from './content-studio/generation-profile-picker'
import type { GenerationProfileConfig } from '@anubis/shared'
```

2. State: alongside `pageStepProfiles`, add

```tsx
  const [genProfiles, setGenProfiles] = useState<GenerationProfileConfig>({})
```

3. In the config-loading effect (the one that sets `pageStepProfiles`), also set gen profiles:

```tsx
  useEffect(() => {
    void getAppConfig().then((cfg) => {
      setPageStepProfiles(cfg.pipelineStepProfiles ?? {})
      setGenProfiles(cfg.generationProfiles ?? {})
    })
  }, [])
```

4. Add a debounced change handler next to `onPageStepProfilesChange`:

```tsx
  const onGenProfilesChange = useCallback((next: GenerationProfileConfig) => {
    setGenProfiles(next)
    if (genDebounceRef.current) clearTimeout(genDebounceRef.current)
    genDebounceRef.current = setTimeout(() => {
      void updateAppConfig({ generationProfiles: next })
    }, 500)
  }, [])
```

Add the ref near the existing `debounceRef`:

```tsx
  const genDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

(If the existing `debounceRef` uses a different type annotation, mirror it exactly.)

5. Render the picker directly below `<StepProfilePicker … />`:

```tsx
          <GenerationProfilePicker
            profiles={profiles}
            generationProfiles={genProfiles}
            onChange={onGenProfilesChange}
          />
```

- [ ] **Step 3: Typecheck + build the frontend**

Run: `pnpm --filter @anubis/frontend build`
Expected: clean. (If `useRef`/`useCallback` aren't imported in `content-studio.tsx`, add them — check the existing React import line first.)

- [ ] **Step 4: Run frontend tests**

Run: `cd packages/frontend && pnpm vitest run`
Expected: all PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/pages/content-studio/generation-profile-picker.tsx packages/frontend/src/pages/content-studio.tsx
git commit -m "feat(content-studio): generation profile picker (image/video)"
```

---

## Task 9: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Rebuild the dependency chain**

Run:
```
pnpm --filter @anubis/shared build
pnpm --filter @anubis/conversation build
pnpm --filter @anubis/ai-agent build
pnpm --filter @anubis/backend build
pnpm --filter @anubis/frontend build
```
Expected: all clean.

- [ ] **Step 2: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Run the affected suites**

Run:
```
pnpm vitest run packages/backend/tests/agent-run.test.ts packages/backend/tests/config-route.test.ts packages/backend/tests/content-generation packages/backend/tests/content-pipeline packages/backend/tests/content-pipeline-routes.test.ts --maxWorkers=2
pnpm vitest run packages/conversation/tests/profiles --maxWorkers=2
```
Expected: all green.

- [ ] **Step 4: Manual app verification (per the `verify` skill)**

Launch the desktop app → Content Studio:
- The header shows a **Generation AI Profiles** row with Image + Video pickers; the Image picker includes "Google Flow (browser)" plus the agent profiles (incl. "Codex — Image Generator"); Video lists agent profiles (incl. "Codex — Video Generator").
- Selecting profiles persists (reload the page; selection sticks).
- For an item with refined content: run generation. With the **Codex image** profile, an image file lands in the item asset dir and the draft renders it; with **Google Flow** selected, the Flow path still works. With a **video** profile on a video item, an `.mp4` is produced (requires Node+npm+FFmpeg + Codex on the host; first run installs hyperframes).

- [ ] **Step 5: Commit any verification fixes**

```bash
git add -A
git commit -m "fix(content-generation): verification follow-ups for agent media generators"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** §1 config → Task 1+2; §2 default profiles → Task 3; §3 generators → Task 5 (+ registry Task 7); §4 shared agent-run → Task 4; §5 derive-tasks → Task 6; §6 UI → Task 8; §7 error handling → covered by `runProfileAgent` errors + `generateViaAgent` "no output" throw; §8 testing → each task + Task 9.
- **Type/name consistency:** `FLOW_IMAGE_PROFILE_ID` ('google-flow') is defined in `agent-generators.ts` and mirrored as a literal in the frontend picker (commented). `runProfileAgent(stack, agentService, input)` signature is used identically in Tasks 4 and 7. Generator class names: `ConfigurableImageGenerator`, `AgentVideoGenerator`. Default profile ids: `codex-image`, `codex-video` (Task 3 ↔ Task 5).
- **No new third-party dep** in the app → no root `package.json`/packaging change. hyperframes is installed at runtime by the agent.
- **Behavior-preservation:** the pipeline `runAgent` model precedence (`stepModel ?? resolved.model ?? ai_review-claude REVIEW_MODEL`) is recomputed in `factory.ts` before calling `runProfileAgent`, so the pipeline path is unchanged (Task 4 Step 6 re-runs its tests to confirm).
