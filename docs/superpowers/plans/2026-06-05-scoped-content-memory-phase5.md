# Scoped Content Memory — Phase 5 (Validators + Agent-Run Wiring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. **Prerequisite: Phases 1–4 merged.**

**Goal:** Catch unsafe/off-brand output before human review, and record every content task as a traceable `agent_run`. Four MVP validators flag workspace leakage, brand-rule violations, repeated mistakes, and platform-rule violations; an `AgentRunService` persists the full run trace tying output back to its context pack and retrieved sources.

**Architecture:** A `validators/` module with an `OutputValidator` interface and four deterministic validators, aggregated by a `ValidationService`. `agent_runs` table + repo + `AgentRunService.saveRun`. `ContentMemoryService` gains `getPack` (load a persisted pack) so the validate route can score an output against its pack. HTTP routes `POST /content-memory/validate` and `POST /content-memory/runs`. The approval/rejection feedback loop reuses Phase 4's `ExperienceIndexService.saveFeedback`.

**Tech Stack:** TypeScript (ESM, NodeNext), better-sqlite3, Hono, Vitest.

**Reference:** design `2026-06-05-scoped-content-memory-design.md` (§7, this implements §8 Phase 5); original spec §9.5 (`agent_runs`), §16.4 (`saveRun`), §17 (validators), §20.1 (workspace isolation).

---

## Scope of this phase

In scope:
- `OutputValidator` interface + `ValidationResult`/`ValidationIssue` types.
- Four validators: `WorkspaceLeakageValidator`, `BrandRuleValidator`, `RepeatedMistakeValidator`, `PlatformRuleValidator`.
- `ValidationService` (run all, aggregate, max severity).
- `agent_runs` (migration 015) + `AgentRunsRepo` + `AgentRunService.saveRun`.
- `ContentMemoryService.getPack`.
- Routes `POST /content-memory/validate`, `POST /content-memory/runs`.
- Tests for each validator + aggregation + run persistence.

Out of scope (separate / pending engine): validators-as-workflow-nodes and the durable rejection→regenerate loop (they call `ValidationService` / `ExperienceIndexService` — the seams built here and in Phase 4); LLM-judge validators (the MVP validators are deterministic heuristics, documented as replaceable). The validators are **heuristic** by design — they reduce obvious mistakes, not guarantee correctness.

**Migration bookkeeping:** content-memory owns 008/009/011/012/013/014 and now **015**. `CONTENT_MEMORY_MIGRATIONS` → `[8, 9, 11, 12, 13, 14, 15]`.

---

## File structure

New in `packages/content-memory/`:
```
src/validators/types.ts
src/validators/helpers.ts                 # forbiddenPhraseViolations
src/validators/workspace-leakage-validator.ts
src/validators/brand-rule-validator.ts
src/validators/platform-rule-validator.ts
src/validators/repeated-mistake-validator.ts
src/validators/validation-service.ts
src/db/migrations/015_agent_runs.sql
src/db/repositories/agent-runs-repo.ts
src/agent-runs/agent-run-service.ts
tests/validators/helpers.test.ts
tests/validators/workspace-leakage-validator.test.ts
tests/validators/brand-rule-validator.test.ts
tests/validators/repeated-mistake-validator.test.ts
tests/validators/platform-rule-validator.test.ts
tests/validators/validation-service.test.ts
tests/agent-runs-repo.test.ts
```
Modified in `packages/content-memory/`:
```
src/service.ts                            # getPack
src/db/migrations/index.ts                 # + 015
src/index.ts                               # exports
tests/migrations-index.test.ts             # expect [8,9,11,12,13,14,15]
```
Modified in `packages/conversation/` + `packages/backend/`:
```
packages/conversation/src/index.ts          # instantiate validation + agentRuns, expose
packages/backend/src/content-memory.ts       # validate + runs routes
```

---

## Task 1: Validator types + shared helper

**Files:**
- Create: `packages/content-memory/src/validators/types.ts`
- Create: `packages/content-memory/src/validators/helpers.ts`
- Test: `packages/content-memory/tests/validators/helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/content-memory/tests/validators/helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { forbiddenPhraseViolations } from '../../src/validators/helpers.js'

describe('forbiddenPhraseViolations', () => {
  it('flags an "avoid X" rule when X appears in the output', () => {
    const hits = forbiddenPhraseViolations(
      ['avoid fear-based hooks', 'no medical claims'],
      'This opens with fear-based hooks for impact.',
    )
    expect(hits).toContain('fear-based hooks')
  })

  it('returns nothing when no rule is matched', () => {
    expect(forbiddenPhraseViolations(['avoid hype'], 'a calm educational caption')).toEqual([])
  })

  it('ignores rules with no parseable forbidden phrase', () => {
    expect(forbiddenPhraseViolations(['be professional'], 'anything')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/validators/helpers.test.ts`
Expected: FAIL — helper not found.

- [ ] **Step 3: Create the types**

Create `packages/content-memory/src/validators/types.ts`:

```ts
import type { Platform, Severity } from '../types.js'
import type { ContentContextPack } from '../context-pack/types.js'

export type ValidationIssueType =
  | 'workspace_leakage' | 'brand_violation' | 'platform_violation'
  | 'repeated_mistake' | 'missing_context' | 'unsupported_claim'
  | 'format_error' | 'sensitive_data'

export interface ValidationIssue {
  type: ValidationIssueType
  message: string
  relatedMemoryId?: string
  suggestedCorrection?: string
}

export interface ValidationResult {
  passed: boolean
  severity?: Severity
  issues: ValidationIssue[]
}

export interface ValidateInput {
  workspaceId: string
  platform: Platform
  contextPack: ContentContextPack
  output: string
}

export interface OutputValidator {
  name: string
  validate(input: ValidateInput): Promise<ValidationResult>
}
```

- [ ] **Step 4: Create the shared helper**

Create `packages/content-memory/src/validators/helpers.ts`:

```ts
/**
 * Heuristic: parse "avoid/no/never/don't use X" rules and return the X phrases
 * that appear (case-insensitive) in the output. Deterministic MVP check — meant
 * to catch obvious violations, not replace an LLM judge.
 */
export function forbiddenPhraseViolations(rules: string[], output: string): string[] {
  const out = output.toLowerCase()
  const hits = new Set<string>()
  for (const rule of rules) {
    const m = rule.match(/(?:never use|never|avoid|do not use|don['’]?t use|no)\s+(.+)/i)
    const phrase = (m?.[1] ?? '').trim().replace(/[.?!]+$/, '')
    if (phrase.length >= 3 && out.includes(phrase.toLowerCase())) hits.add(phrase)
  }
  return [...hits]
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/validators/helpers.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/content-memory/src/validators/types.ts packages/content-memory/src/validators/helpers.ts packages/content-memory/tests/validators/helpers.test.ts
git commit -m "feat(content-memory): validator types + forbidden-phrase helper"
```

---

## Task 2: WorkspaceLeakageValidator

**Files:**
- Create: `packages/content-memory/src/validators/workspace-leakage-validator.ts`
- Test: `packages/content-memory/tests/validators/workspace-leakage-validator.test.ts`

This is the §20.1 isolation guard at the output layer: flag output that names a *different* brand workspace.

- [ ] **Step 1: Write the failing test**

Create `packages/content-memory/tests/validators/workspace-leakage-validator.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from '../helpers/db.js'
import { BrandWorkspacesRepo } from '../../src/db/repositories/brand-workspaces-repo.js'
import { WorkspaceLeakageValidator } from '../../src/validators/workspace-leakage-validator.js'
import type { ContentContextPack } from '../../src/context-pack/types.js'

const here = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(here, '../../src/db/migrations/008_brand_workspaces.sql'), 'utf8')

function pack(workspaceId: string): ContentContextPack {
  return {
    workspaceId, platform: 'instagram', taskType: 'generate_content', objective: 'o',
    brandContext: { brandSummary: '', toneOfVoice: [], audience: [], offers: [], constraints: [] },
    platformContext: { platform: 'instagram', formatRules: [], contentPatterns: [], algorithmNotes: [] },
    similarContent: { approved: [], competitor: [], rejected: [] },
    globalFrameworks: { hooks: [], copywritingPatterns: [], contentStructures: [], ctaPatterns: [] },
    workspaceRules: { mustFollow: [], mustAvoid: [], clientPreferences: [] },
    experienceMemory: { previousMistakes: [], reviewerFeedback: [], validationRules: [] },
    citations: [], finalInstruction: '',
  }
}

function setup() {
  const db = freshDb([{ version: 8, sql }])
  const brands = new BrandWorkspacesRepo(db)
  brands.insert({ id: 'ws-a', name: 'GlowSkin', brandSummary: null, toneOfVoice: [], audience: [],
    offers: [], constraints: [], status: 'active', createdAt: 1, updatedAt: 1 })
  brands.insert({ id: 'ws-b', name: 'IronFit', brandSummary: null, toneOfVoice: [], audience: [],
    offers: [], constraints: [], status: 'active', createdAt: 1, updatedAt: 1 })
  return new WorkspaceLeakageValidator(brands)
}

describe('WorkspaceLeakageValidator', () => {
  it('flags output that names another brand workspace', async () => {
    const v = setup()
    const r = await v.validate({
      workspaceId: 'ws-a', platform: 'instagram', contextPack: pack('ws-a'),
      output: 'Just like IronFit does, try this routine.',
    })
    expect(r.passed).toBe(false)
    expect(r.issues[0]!.type).toBe('workspace_leakage')
    expect(r.severity).toBe('critical')
  })

  it('passes clean output that names only the active brand', async () => {
    const v = setup()
    const r = await v.validate({
      workspaceId: 'ws-a', platform: 'instagram', contextPack: pack('ws-a'),
      output: 'GlowSkin gentle routine for the evening.',
    })
    expect(r.passed).toBe(true)
    expect(r.issues).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/validators/workspace-leakage-validator.test.ts`
Expected: FAIL — validator not found.

- [ ] **Step 3: Create the validator**

Create `packages/content-memory/src/validators/workspace-leakage-validator.ts`:

```ts
import type { BrandWorkspacesRepo } from '../db/repositories/brand-workspaces-repo.js'
import type { OutputValidator, ValidateInput, ValidationIssue, ValidationResult } from './types.js'

export class WorkspaceLeakageValidator implements OutputValidator {
  name = 'WorkspaceLeakageValidator'
  constructor(private brands: BrandWorkspacesRepo) {}

  async validate(input: ValidateInput): Promise<ValidationResult> {
    const out = input.output.toLowerCase()
    const issues: ValidationIssue[] = []
    for (const b of this.brands.list()) {
      if (b.id === input.workspaceId) continue
      const name = b.name.trim().toLowerCase()
      if (name.length >= 3 && out.includes(name)) {
        issues.push({
          type: 'workspace_leakage',
          message: `Output references another brand workspace "${b.name}".`,
        })
      }
    }
    return { passed: issues.length === 0, severity: issues.length ? 'critical' : undefined, issues }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/validators/workspace-leakage-validator.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/content-memory/src/validators/workspace-leakage-validator.ts packages/content-memory/tests/validators/workspace-leakage-validator.test.ts
git commit -m "feat(content-memory): WorkspaceLeakageValidator"
```

---

## Task 3: BrandRuleValidator + PlatformRuleValidator

**Files:**
- Create: `packages/content-memory/src/validators/brand-rule-validator.ts`
- Create: `packages/content-memory/src/validators/platform-rule-validator.ts`
- Test: `packages/content-memory/tests/validators/brand-rule-validator.test.ts`
- Test: `packages/content-memory/tests/validators/platform-rule-validator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/content-memory/tests/validators/brand-rule-validator.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { BrandRuleValidator } from '../../src/validators/brand-rule-validator.js'
import type { ContentContextPack } from '../../src/context-pack/types.js'

function pack(over: Partial<ContentContextPack['brandContext'] & ContentContextPack['workspaceRules']>): ContentContextPack {
  return {
    workspaceId: 'ws-a', platform: 'instagram', taskType: 'generate_content', objective: 'o',
    brandContext: { brandSummary: '', toneOfVoice: [], audience: [], offers: [],
      constraints: over.constraints ?? [] },
    platformContext: { platform: 'instagram', formatRules: [], contentPatterns: [], algorithmNotes: [] },
    similarContent: { approved: [], competitor: [], rejected: [] },
    globalFrameworks: { hooks: [], copywritingPatterns: [], contentStructures: [], ctaPatterns: [] },
    workspaceRules: { mustFollow: over.mustFollow ?? [], mustAvoid: over.mustAvoid ?? [], clientPreferences: [] },
    experienceMemory: { previousMistakes: [], reviewerFeedback: [], validationRules: [] },
    citations: [], finalInstruction: '',
  }
}

describe('BrandRuleValidator', () => {
  it('flags output that violates a brand constraint', async () => {
    const v = new BrandRuleValidator()
    const r = await v.validate({
      workspaceId: 'ws-a', platform: 'instagram',
      contextPack: pack({ constraints: ['avoid fear-based hooks'] }),
      output: 'Use fear-based hooks to grab attention.',
    })
    expect(r.passed).toBe(false)
    expect(r.issues[0]!.type).toBe('brand_violation')
    expect(r.severity).toBe('high')
  })

  it('passes compliant output', async () => {
    const v = new BrandRuleValidator()
    const r = await v.validate({
      workspaceId: 'ws-a', platform: 'instagram',
      contextPack: pack({ constraints: ['avoid fear-based hooks'] }),
      output: 'A calm, educational opener.',
    })
    expect(r.passed).toBe(true)
  })
})
```

Create `packages/content-memory/tests/validators/platform-rule-validator.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PlatformRuleValidator } from '../../src/validators/platform-rule-validator.js'
import type { ContentContextPack } from '../../src/context-pack/types.js'

function pack(formatRules: string[]): ContentContextPack {
  return {
    workspaceId: 'ws-a', platform: 'instagram', taskType: 'generate_content', objective: 'o',
    brandContext: { brandSummary: '', toneOfVoice: [], audience: [], offers: [], constraints: [] },
    platformContext: { platform: 'instagram', formatRules, contentPatterns: [], algorithmNotes: [] },
    similarContent: { approved: [], competitor: [], rejected: [] },
    globalFrameworks: { hooks: [], copywritingPatterns: [], contentStructures: [], ctaPatterns: [] },
    workspaceRules: { mustFollow: [], mustAvoid: [], clientPreferences: [] },
    experienceMemory: { previousMistakes: [], reviewerFeedback: [], validationRules: [] },
    citations: [], finalInstruction: '',
  }
}

describe('PlatformRuleValidator', () => {
  it('flags output that violates a platform format rule', async () => {
    const v = new PlatformRuleValidator()
    const r = await v.validate({
      workspaceId: 'ws-a', platform: 'instagram',
      contextPack: pack(['avoid external links in the caption']),
      output: 'Read more via external links in the caption below.',
    })
    expect(r.passed).toBe(false)
    expect(r.issues[0]!.type).toBe('platform_violation')
    expect(r.severity).toBe('medium')
  })

  it('passes when no rule is violated', async () => {
    const v = new PlatformRuleValidator()
    const r = await v.validate({
      workspaceId: 'ws-a', platform: 'instagram',
      contextPack: pack(['avoid external links in the caption']),
      output: 'A clean caption with a strong hook.',
    })
    expect(r.passed).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/content-memory/tests/validators/brand-rule-validator.test.ts packages/content-memory/tests/validators/platform-rule-validator.test.ts`
Expected: FAIL — validators not found.

- [ ] **Step 3: Create BrandRuleValidator**

Create `packages/content-memory/src/validators/brand-rule-validator.ts`:

```ts
import { forbiddenPhraseViolations } from './helpers.js'
import type { OutputValidator, ValidateInput, ValidationIssue, ValidationResult } from './types.js'

export class BrandRuleValidator implements OutputValidator {
  name = 'BrandRuleValidator'

  async validate(input: ValidateInput): Promise<ValidationResult> {
    const rules = [
      ...input.contextPack.brandContext.constraints,
      ...input.contextPack.workspaceRules.mustAvoid,
    ]
    const issues: ValidationIssue[] = forbiddenPhraseViolations(rules, input.output).map((h) => ({
      type: 'brand_violation',
      message: `Output appears to violate a brand rule: avoid "${h}".`,
      suggestedCorrection: `Remove or rephrase content about "${h}".`,
    }))
    return { passed: issues.length === 0, severity: issues.length ? 'high' : undefined, issues }
  }
}
```

- [ ] **Step 4: Create PlatformRuleValidator**

Create `packages/content-memory/src/validators/platform-rule-validator.ts`:

```ts
import { forbiddenPhraseViolations } from './helpers.js'
import type { OutputValidator, ValidateInput, ValidationIssue, ValidationResult } from './types.js'

export class PlatformRuleValidator implements OutputValidator {
  name = 'PlatformRuleValidator'

  async validate(input: ValidateInput): Promise<ValidationResult> {
    const issues: ValidationIssue[] = forbiddenPhraseViolations(
      input.contextPack.platformContext.formatRules,
      input.output,
    ).map((h) => ({
      type: 'platform_violation',
      message: `Output appears to violate a platform rule: avoid "${h}".`,
    }))
    return { passed: issues.length === 0, severity: issues.length ? 'medium' : undefined, issues }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/content-memory/tests/validators/brand-rule-validator.test.ts packages/content-memory/tests/validators/platform-rule-validator.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/content-memory/src/validators/brand-rule-validator.ts packages/content-memory/src/validators/platform-rule-validator.ts packages/content-memory/tests/validators/brand-rule-validator.test.ts packages/content-memory/tests/validators/platform-rule-validator.test.ts
git commit -m "feat(content-memory): Brand + Platform rule validators"
```

---

## Task 4: RepeatedMistakeValidator

**Files:**
- Create: `packages/content-memory/src/validators/repeated-mistake-validator.ts`
- Test: `packages/content-memory/tests/validators/repeated-mistake-validator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/content-memory/tests/validators/repeated-mistake-validator.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from '../helpers/db.js'
import { BrandWorkspacesRepo } from '../../src/db/repositories/brand-workspaces-repo.js'
import { ExperienceMemoriesRepo } from '../../src/db/repositories/experience-memories-repo.js'
import { ExperienceIndexService } from '../../src/experience/experience-index-service.js'
import { RepeatedMistakeValidator } from '../../src/validators/repeated-mistake-validator.js'
import type { ContentContextPack } from '../../src/context-pack/types.js'

const here = dirname(fileURLToPath(import.meta.url))
const sqlFor = (f: string) => readFileSync(join(here, '../../src/db/migrations', f), 'utf8')
const migrations = [
  { version: 8, sql: sqlFor('008_brand_workspaces.sql') },
  { version: 14, sql: sqlFor('014_experience_memories.sql') },
]

function emptyPack(): ContentContextPack {
  return {
    workspaceId: 'ws-a', platform: 'instagram', taskType: 'generate_content', objective: 'o',
    brandContext: { brandSummary: '', toneOfVoice: [], audience: [], offers: [], constraints: [] },
    platformContext: { platform: 'instagram', formatRules: [], contentPatterns: [], algorithmNotes: [] },
    similarContent: { approved: [], competitor: [], rejected: [] },
    globalFrameworks: { hooks: [], copywritingPatterns: [], contentStructures: [], ctaPatterns: [] },
    workspaceRules: { mustFollow: [], mustAvoid: [], clientPreferences: [] },
    experienceMemory: { previousMistakes: [], reviewerFeedback: [], validationRules: [] },
    citations: [], finalInstruction: '',
  }
}

function setup() {
  const db = freshDb(migrations)
  new BrandWorkspacesRepo(db).insert({ id: 'ws-a', name: 'A', brandSummary: null, toneOfVoice: [],
    audience: [], offers: [], constraints: [], status: 'active', createdAt: 1, updatedAt: 1 })
  const experience = new ExperienceIndexService(new ExperienceMemoriesRepo(db))
  return { experience, v: new RepeatedMistakeValidator(experience) }
}

describe('RepeatedMistakeValidator', () => {
  it('flags output that hits an active mistake trigger pattern', async () => {
    const { experience, v } = setup()
    const m = experience.recordCandidate({
      workspaceId: 'ws-a', type: 'mistake', title: 'Fear hook',
      problem: 'used a fear hook', correction: 'use a soft hook',
      triggerPattern: 'scary truth',
    })
    experience.promote(m.id)
    const r = await v.validate({
      workspaceId: 'ws-a', platform: 'instagram', contextPack: emptyPack(),
      output: "Here's the scary truth about your skin.",
    })
    expect(r.passed).toBe(false)
    expect(r.issues[0]!.type).toBe('repeated_mistake')
    expect(r.issues[0]!.relatedMemoryId).toBe(m.id)
    expect(r.issues[0]!.suggestedCorrection).toBe('use a soft hook')
  })

  it('passes when no trigger pattern matches', async () => {
    const { experience, v } = setup()
    const m = experience.recordCandidate({
      workspaceId: 'ws-a', type: 'mistake', title: 'Fear hook',
      problem: 'x', correction: 'y', triggerPattern: 'scary truth',
    })
    experience.promote(m.id)
    const r = await v.validate({
      workspaceId: 'ws-a', platform: 'instagram', contextPack: emptyPack(),
      output: 'A gentle, helpful tip.',
    })
    expect(r.passed).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/validators/repeated-mistake-validator.test.ts`
Expected: FAIL — validator not found.

- [ ] **Step 3: Create the validator**

Create `packages/content-memory/src/validators/repeated-mistake-validator.ts`:

```ts
import type { ExperienceIndexService } from '../experience/experience-index-service.js'
import type { OutputValidator, ValidateInput, ValidationIssue, ValidationResult } from './types.js'

export class RepeatedMistakeValidator implements OutputValidator {
  name = 'RepeatedMistakeValidator'
  constructor(private experience: ExperienceIndexService) {}

  async validate(input: ValidateInput): Promise<ValidationResult> {
    const out = input.output.toLowerCase()
    const memories = this.experience.recallActive({
      workspaceId: input.workspaceId, platform: input.platform, limit: 50,
    })
    const issues: ValidationIssue[] = []
    for (const m of memories) {
      if (m.type !== 'mistake' && m.type !== 'anti_pattern') continue
      const trigger = (m.triggerPattern ?? '').trim().toLowerCase()
      if (trigger.length >= 3 && out.includes(trigger)) {
        issues.push({
          type: 'repeated_mistake',
          message: `Output repeats a known mistake: ${m.title}.`,
          relatedMemoryId: m.id,
          suggestedCorrection: m.correction,
        })
      }
    }
    return { passed: issues.length === 0, severity: issues.length ? 'high' : undefined, issues }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/validators/repeated-mistake-validator.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/content-memory/src/validators/repeated-mistake-validator.ts packages/content-memory/tests/validators/repeated-mistake-validator.test.ts
git commit -m "feat(content-memory): RepeatedMistakeValidator"
```

---

## Task 5: ValidationService (aggregate)

**Files:**
- Create: `packages/content-memory/src/validators/validation-service.ts`
- Test: `packages/content-memory/tests/validators/validation-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/content-memory/tests/validators/validation-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ValidationService } from '../../src/validators/validation-service.js'
import type { OutputValidator, ValidationResult } from '../../src/validators/types.js'
import type { ContentContextPack } from '../../src/context-pack/types.js'

function emptyPack(): ContentContextPack {
  return {
    workspaceId: 'ws-a', platform: 'instagram', taskType: 'generate_content', objective: 'o',
    brandContext: { brandSummary: '', toneOfVoice: [], audience: [], offers: [], constraints: [] },
    platformContext: { platform: 'instagram', formatRules: [], contentPatterns: [], algorithmNotes: [] },
    similarContent: { approved: [], competitor: [], rejected: [] },
    globalFrameworks: { hooks: [], copywritingPatterns: [], contentStructures: [], ctaPatterns: [] },
    workspaceRules: { mustFollow: [], mustAvoid: [], clientPreferences: [] },
    experienceMemory: { previousMistakes: [], reviewerFeedback: [], validationRules: [] },
    citations: [], finalInstruction: '',
  }
}

function fake(name: string, result: ValidationResult): OutputValidator {
  return { name, validate: async () => result }
}

describe('ValidationService', () => {
  it('passes when all validators pass', async () => {
    const svc = new ValidationService([
      fake('a', { passed: true, issues: [] }),
      fake('b', { passed: true, issues: [] }),
    ])
    const r = await svc.validate({ workspaceId: 'ws-a', platform: 'instagram', contextPack: emptyPack(), output: 'x' })
    expect(r.passed).toBe(true)
    expect(r.issues).toHaveLength(0)
  })

  it('aggregates issues and reports the max severity', async () => {
    const svc = new ValidationService([
      fake('a', { passed: false, severity: 'medium', issues: [{ type: 'platform_violation', message: 'm' }] }),
      fake('b', { passed: false, severity: 'critical', issues: [{ type: 'workspace_leakage', message: 'l' }] }),
    ])
    const r = await svc.validate({ workspaceId: 'ws-a', platform: 'instagram', contextPack: emptyPack(), output: 'x' })
    expect(r.passed).toBe(false)
    expect(r.issues).toHaveLength(2)
    expect(r.severity).toBe('critical')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/validators/validation-service.test.ts`
Expected: FAIL — service not found.

- [ ] **Step 3: Create the service**

Create `packages/content-memory/src/validators/validation-service.ts`:

```ts
import type { Severity } from '../types.js'
import type { OutputValidator, ValidateInput, ValidationResult } from './types.js'

const SEVERITY_ORDER: Severity[] = ['low', 'medium', 'high', 'critical']

export class ValidationService {
  constructor(private validators: OutputValidator[]) {}

  async validate(input: ValidateInput): Promise<ValidationResult> {
    const results = await Promise.all(this.validators.map((v) => v.validate(input)))
    const issues = results.flatMap((r) => r.issues)
    const severities = results
      .map((r) => r.severity)
      .filter((s): s is Severity => Boolean(s))
      .sort((a, b) => SEVERITY_ORDER.indexOf(b) - SEVERITY_ORDER.indexOf(a))
    return {
      passed: issues.length === 0,
      severity: severities[0],
      issues,
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/validators/validation-service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/content-memory/src/validators/validation-service.ts packages/content-memory/tests/validators/validation-service.test.ts
git commit -m "feat(content-memory): ValidationService aggregation"
```

---

## Task 6: `agent_runs` table + repo + service

**Files:**
- Create: `packages/content-memory/src/db/migrations/015_agent_runs.sql`
- Create: `packages/content-memory/src/db/repositories/agent-runs-repo.ts`
- Create: `packages/content-memory/src/agent-runs/agent-run-service.ts`
- Test: `packages/content-memory/tests/agent-runs-repo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/content-memory/tests/agent-runs-repo.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db.js'
import { BrandWorkspacesRepo } from '../src/db/repositories/brand-workspaces-repo.js'
import { AgentRunsRepo } from '../src/db/repositories/agent-runs-repo.js'
import { AgentRunService } from '../src/agent-runs/agent-run-service.js'

const here = dirname(fileURLToPath(import.meta.url))
const sqlFor = (f: string) => readFileSync(join(here, '../src/db/migrations', f), 'utf8')
const migrations = [
  { version: 8, sql: sqlFor('008_brand_workspaces.sql') },
  { version: 15, sql: sqlFor('015_agent_runs.sql') },
]

function setup() {
  const db = freshDb(migrations)
  new BrandWorkspacesRepo(db).insert({ id: 'ws-a', name: 'A', brandSummary: null, toneOfVoice: [],
    audience: [], offers: [], constraints: [], status: 'active', createdAt: 1, updatedAt: 1 })
  const repo = new AgentRunsRepo(db)
  return { repo, svc: new AgentRunService(repo) }
}

describe('AgentRunService.saveRun', () => {
  it('persists a run trace with retrieved id arrays round-tripped', () => {
    const { svc, repo } = setup()
    const run = svc.saveRun({
      workspaceId: 'ws-a', platform: 'instagram', agentId: 'agent-1',
      taskType: 'generate_content', userInput: 'make a post', intent: 'generate',
      output: 'the post', validationStatus: 'passed',
      retrievedChunkIds: ['c1', 'c2'],
      retrievedSimilarityItemIds: ['s1'],
      contextPackId: 'pack-1',
    })
    const got = repo.findById(run.id)
    expect(got?.validationStatus).toBe('passed')
    expect(got?.retrievedChunkIds).toEqual(['c1', 'c2'])
    expect(got?.retrievedSimilarityItemIds).toEqual(['s1'])
    expect(got?.contextPackId).toBe('pack-1')
  })

  it('lists runs for a workspace most-recent first', () => {
    const { svc, repo } = setup()
    svc.saveRun({ workspaceId: 'ws-a', agentId: 'a', taskType: 'generate_content',
      userInput: 'u', intent: 'i', output: 'o', validationStatus: 'passed' }, 100)
    svc.saveRun({ workspaceId: 'ws-a', agentId: 'a', taskType: 'generate_content',
      userInput: 'u', intent: 'i', output: 'o', validationStatus: 'failed' }, 200)
    const runs = repo.listForWorkspace('ws-a')
    expect(runs[0]!.validationStatus).toBe('failed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/content-memory/tests/agent-runs-repo.test.ts`
Expected: FAIL — migration / repo / service missing.

- [ ] **Step 3: Create the migration**

Create `packages/content-memory/src/db/migrations/015_agent_runs.sql`:

```sql
CREATE TABLE agent_runs (
  id                              TEXT PRIMARY KEY,
  workspace_id                    TEXT NOT NULL REFERENCES brand_workspaces(id),
  platform                        TEXT,
  campaign_id                     TEXT,
  agent_id                        TEXT NOT NULL,
  workflow_id                     TEXT,
  task_type                       TEXT NOT NULL,
  user_input                      TEXT NOT NULL,
  intent                          TEXT NOT NULL,
  retrieved_chunk_ids             TEXT NOT NULL DEFAULT '[]',
  retrieved_decision_ids          TEXT NOT NULL DEFAULT '[]',
  retrieved_experience_memory_ids TEXT NOT NULL DEFAULT '[]',
  retrieved_similarity_item_ids   TEXT NOT NULL DEFAULT '[]',
  context_pack_id                 TEXT,
  plan                            TEXT,
  output                          TEXT NOT NULL,
  validation_status               TEXT NOT NULL CHECK (validation_status IN ('passed','failed','needs_review')),
  human_feedback                  TEXT,
  error_type                      TEXT,
  error_summary                   TEXT,
  created_at                      INTEGER NOT NULL
);
CREATE INDEX idx_agent_runs_workspace ON agent_runs(workspace_id, created_at DESC);
```

- [ ] **Step 4: Create the repo**

Create `packages/content-memory/src/db/repositories/agent-runs-repo.ts`:

```ts
import type { Db } from '../types.js'
import type { Platform } from '../../types.js'

export type ValidationStatus = 'passed' | 'failed' | 'needs_review'

export interface AgentRun {
  id: string
  workspaceId: string
  platform: Platform | null
  campaignId: string | null
  agentId: string
  workflowId: string | null
  taskType: string
  userInput: string
  intent: string
  retrievedChunkIds: string[]
  retrievedDecisionIds: string[]
  retrievedExperienceMemoryIds: string[]
  retrievedSimilarityItemIds: string[]
  contextPackId: string | null
  plan: string | null
  output: string
  validationStatus: ValidationStatus
  humanFeedback: string | null
  errorType: string | null
  errorSummary: string | null
  createdAt: number
}

interface Row {
  id: string
  workspace_id: string
  platform: string | null
  campaign_id: string | null
  agent_id: string
  workflow_id: string | null
  task_type: string
  user_input: string
  intent: string
  retrieved_chunk_ids: string
  retrieved_decision_ids: string
  retrieved_experience_memory_ids: string
  retrieved_similarity_item_ids: string
  context_pack_id: string | null
  plan: string | null
  output: string
  validation_status: string
  human_feedback: string | null
  error_type: string | null
  error_summary: string | null
  created_at: number
}

function parseArr(s: string): string[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? (v as string[]) : [] } catch { return [] }
}

function toRun(r: Row): AgentRun {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    platform: (r.platform as Platform | null) ?? null,
    campaignId: r.campaign_id,
    agentId: r.agent_id,
    workflowId: r.workflow_id,
    taskType: r.task_type,
    userInput: r.user_input,
    intent: r.intent,
    retrievedChunkIds: parseArr(r.retrieved_chunk_ids),
    retrievedDecisionIds: parseArr(r.retrieved_decision_ids),
    retrievedExperienceMemoryIds: parseArr(r.retrieved_experience_memory_ids),
    retrievedSimilarityItemIds: parseArr(r.retrieved_similarity_item_ids),
    contextPackId: r.context_pack_id,
    plan: r.plan,
    output: r.output,
    validationStatus: r.validation_status as ValidationStatus,
    humanFeedback: r.human_feedback,
    errorType: r.error_type,
    errorSummary: r.error_summary,
    createdAt: r.created_at,
  }
}

export class AgentRunsRepo {
  constructor(private db: Db) {}

  insert(run: AgentRun): void {
    this.db.prepare(`
      INSERT INTO agent_runs (
        id, workspace_id, platform, campaign_id, agent_id, workflow_id, task_type,
        user_input, intent, retrieved_chunk_ids, retrieved_decision_ids,
        retrieved_experience_memory_ids, retrieved_similarity_item_ids,
        context_pack_id, plan, output, validation_status, human_feedback,
        error_type, error_summary, created_at
      ) VALUES (
        @id, @workspaceId, @platform, @campaignId, @agentId, @workflowId, @taskType,
        @userInput, @intent, @retrievedChunkIds, @retrievedDecisionIds,
        @retrievedExperienceMemoryIds, @retrievedSimilarityItemIds,
        @contextPackId, @plan, @output, @validationStatus, @humanFeedback,
        @errorType, @errorSummary, @createdAt
      )
    `).run({
      id: run.id,
      workspaceId: run.workspaceId,
      platform: run.platform ?? null,
      campaignId: run.campaignId ?? null,
      agentId: run.agentId,
      workflowId: run.workflowId ?? null,
      taskType: run.taskType,
      userInput: run.userInput,
      intent: run.intent,
      retrievedChunkIds: JSON.stringify(run.retrievedChunkIds),
      retrievedDecisionIds: JSON.stringify(run.retrievedDecisionIds),
      retrievedExperienceMemoryIds: JSON.stringify(run.retrievedExperienceMemoryIds),
      retrievedSimilarityItemIds: JSON.stringify(run.retrievedSimilarityItemIds),
      contextPackId: run.contextPackId ?? null,
      plan: run.plan ?? null,
      output: run.output,
      validationStatus: run.validationStatus,
      humanFeedback: run.humanFeedback ?? null,
      errorType: run.errorType ?? null,
      errorSummary: run.errorSummary ?? null,
      createdAt: run.createdAt,
    })
  }

  findById(id: string): AgentRun | null {
    const r = this.db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as Row | undefined
    return r ? toRun(r) : null
  }

  listForWorkspace(workspaceId: string, limit = 100): AgentRun[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_runs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(workspaceId, limit) as Row[]
    return rows.map(toRun)
  }
}
```

- [ ] **Step 5: Create the service**

Create `packages/content-memory/src/agent-runs/agent-run-service.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type { Platform } from '../types.js'
import type { AgentRun, AgentRunsRepo, ValidationStatus } from '../db/repositories/agent-runs-repo.js'

export interface SaveAgentRunInput {
  workspaceId: string
  platform?: Platform | null
  campaignId?: string | null
  agentId: string
  workflowId?: string | null
  taskType: string
  userInput: string
  intent: string
  contextPackId?: string | null
  plan?: string | null
  output: string
  retrievedChunkIds?: string[]
  retrievedDecisionIds?: string[]
  retrievedExperienceMemoryIds?: string[]
  retrievedSimilarityItemIds?: string[]
  validationStatus: ValidationStatus
  humanFeedback?: string | null
  errorType?: string | null
  errorSummary?: string | null
}

export class AgentRunService {
  constructor(private repo: AgentRunsRepo) {}

  saveRun(input: SaveAgentRunInput, now: number = Date.now()): AgentRun {
    const run: AgentRun = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      platform: input.platform ?? null,
      campaignId: input.campaignId ?? null,
      agentId: input.agentId,
      workflowId: input.workflowId ?? null,
      taskType: input.taskType,
      userInput: input.userInput,
      intent: input.intent,
      retrievedChunkIds: input.retrievedChunkIds ?? [],
      retrievedDecisionIds: input.retrievedDecisionIds ?? [],
      retrievedExperienceMemoryIds: input.retrievedExperienceMemoryIds ?? [],
      retrievedSimilarityItemIds: input.retrievedSimilarityItemIds ?? [],
      contextPackId: input.contextPackId ?? null,
      plan: input.plan ?? null,
      output: input.output,
      validationStatus: input.validationStatus,
      humanFeedback: input.humanFeedback ?? null,
      errorType: input.errorType ?? null,
      errorSummary: input.errorSummary ?? null,
      createdAt: now,
    }
    this.repo.insert(run)
    return run
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run packages/content-memory/tests/agent-runs-repo.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/content-memory/src/db/migrations/015_agent_runs.sql packages/content-memory/src/db/repositories/agent-runs-repo.ts packages/content-memory/src/agent-runs/agent-run-service.ts packages/content-memory/tests/agent-runs-repo.test.ts
git commit -m "feat(content-memory): agent_runs store + AgentRunService"
```

---

## Task 7: `ContentMemoryService.getPack` + register migration 015 + exports

**Files:**
- Modify: `packages/content-memory/src/service.ts`
- Modify: `packages/content-memory/src/db/migrations/index.ts`
- Modify: `packages/content-memory/src/index.ts`
- Modify: `packages/content-memory/tests/migrations-index.test.ts`
- Modify: `packages/content-memory/tests/content-memory-service.test.ts` (getPack test)

- [ ] **Step 1: Update the migrations-index test (expect 15)**

Replace the assertion in `packages/content-memory/tests/migrations-index.test.ts`:

```ts
    const versions = CONTENT_MEMORY_MIGRATIONS.map((m) => m.version)
    expect(versions).toEqual([8, 9, 11, 12, 13, 14, 15])
```

- [ ] **Step 2: Write the failing getPack test**

Append to `packages/content-memory/tests/content-memory-service.test.ts` (inside the existing `describe`):

```ts
  it('getPack returns a persisted pack by id', async () => {
    const { svc } = setup()
    const { packId } = await svc.buildForContentTask({
      workspaceId: 'workspace-a', platform: 'instagram',
      taskType: 'generate_content', query: 'skincare', objective: 'Generate',
    })
    const pack = svc.getPack(packId)
    expect(pack?.workspaceId).toBe('workspace-a')
    expect(svc.getPack('nope')).toBeNull()
  })
```

- [ ] **Step 3: Register migration 015**

In `packages/content-memory/src/db/migrations/index.ts`, append to the array:

```ts
  load(15, '015_agent_runs.sql'),
```

- [ ] **Step 4: Add `getPack` to `ContentMemoryService`**

In `packages/content-memory/src/service.ts`:

Add the import:

```ts
import type { ContentContextPack } from './context-pack/types.js'
```

(If `ContentContextPack` is already imported in this file from Phase 3, extend the
existing import instead of adding a duplicate.)

Add the method to the class:

```ts
  /** Load a previously built pack by id (e.g. for validation). */
  getPack(packId: string): ContentContextPack | null {
    const rec = this.deps.packs.findById(packId)
    return rec ? (rec.contextJson as ContentContextPack) : null
  }
```

- [ ] **Step 5: Add public exports**

Append to `packages/content-memory/src/index.ts`:

```ts
export type {
  ValidationIssueType, ValidationIssue, ValidationResult, ValidateInput, OutputValidator,
} from './validators/types.js'
export { forbiddenPhraseViolations } from './validators/helpers.js'
export { WorkspaceLeakageValidator } from './validators/workspace-leakage-validator.js'
export { BrandRuleValidator } from './validators/brand-rule-validator.js'
export { PlatformRuleValidator } from './validators/platform-rule-validator.js'
export { RepeatedMistakeValidator } from './validators/repeated-mistake-validator.js'
export { ValidationService } from './validators/validation-service.js'

export type { AgentRun, ValidationStatus } from './db/repositories/agent-runs-repo.js'
export { AgentRunsRepo } from './db/repositories/agent-runs-repo.js'
export type { SaveAgentRunInput } from './agent-runs/agent-run-service.js'
export { AgentRunService } from './agent-runs/agent-run-service.js'
```

- [ ] **Step 6: Run tests + typecheck + build**

Run: `pnpm vitest run packages/content-memory`
Expected: all pass.

Run: `pnpm --filter @anubis/content-memory typecheck && pnpm --filter @anubis/content-memory build`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/content-memory/src/service.ts packages/content-memory/src/db/migrations/index.ts packages/content-memory/src/index.ts packages/content-memory/tests/migrations-index.test.ts packages/content-memory/tests/content-memory-service.test.ts
git commit -m "feat(content-memory): getPack + register agent_runs migration + validator/run exports"
```

---

## Task 8: Wire validation + agent runs into the stack + routes

**Files:**
- Modify: `packages/conversation/src/index.ts`
- Modify: `packages/backend/src/content-memory.ts`
- Test: `packages/conversation/tests/content-memory-stack.test.ts` (extend)

- [ ] **Step 1: Write the failing stack test**

Append to `packages/conversation/tests/content-memory-stack.test.ts` (inside the
`describe`, reusing the `createConversationService` setup):

```ts
  it('exposes validation + agentRuns and flags leakage', async () => {
    dir = mkdtempSync(join(tmpdir(), 'anubis-cm-'))
    const builtin = getBuiltinSkillRoots()
    stack = createConversationService({
      dataDir: dir,
      skillRoots: {
        autoInject: builtin.autoInject, optIn: builtin.optIn,
        user: join(dir, 'skills'), userAutoInject: join(dir, 'skills', 'auto-inject'),
        userOptIn: join(dir, 'skills', 'opt-in'),
      },
    })
    stack.brandWorkspaces.create({ name: 'IronFit' }) // a second brand to leak
    const { pack, packId } = await stack.contentMemory.buildForContentTask({
      workspaceId: 'default-workspace', platform: 'instagram',
      taskType: 'generate_content', query: 'x', objective: 'Generate',
    })
    const result = await stack.validation.validate({
      workspaceId: 'default-workspace', platform: 'instagram',
      contextPack: pack, output: 'Just like IronFit, do this.',
    })
    expect(result.passed).toBe(false)
    const run = stack.agentRuns.saveRun({
      workspaceId: 'default-workspace', agentId: 'a', taskType: 'generate_content',
      userInput: 'x', intent: 'generate', output: 'o',
      validationStatus: 'needs_review', contextPackId: packId,
    })
    expect(stack.agentRuns).toBeDefined()
    expect(run.id).toBeTruthy()
  })
```

Note: `stack.brandWorkspaces` is the Phase 1 `BrandWorkspacesService` exposed on
the stack (Phase 1 Task 8). It has a `create({ name })` method.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/conversation/tests/content-memory-stack.test.ts`
Expected: FAIL — `stack.validation` / `stack.agentRuns` undefined.

- [ ] **Step 3: Wire onto `ConversationStack`**

In `packages/conversation/src/index.ts`:

Extend the `@anubis/content-memory` import:

```ts
  AgentRunService,
  AgentRunsRepo,
  BrandRuleValidator,
  PlatformRuleValidator,
  RepeatedMistakeValidator,
  ValidationService,
  WorkspaceLeakageValidator,
```

Add to the `ConversationStack` interface (after `experience`):

```ts
  validation: ValidationService
  agentRuns: AgentRunService
```

In `createConversationService`, after `experience` is constructed (Phase 4), build
the validators + run service. Note `WorkspaceLeakageValidator` needs a
`BrandWorkspacesRepo`; reuse one instance:

```ts
  const brandWorkspacesRepo = new BrandWorkspacesRepo(db)
  const validation = new ValidationService([
    new WorkspaceLeakageValidator(brandWorkspacesRepo),
    new BrandRuleValidator(),
    new PlatformRuleValidator(),
    new RepeatedMistakeValidator(experience),
  ])
  const agentRuns = new AgentRunService(new AgentRunsRepo(db))
```

Add to the returned object:

```ts
    validation,
    agentRuns,
```

- [ ] **Step 4: Add the validate + runs routes**

Append to `packages/backend/src/content-memory.ts`:

```ts
const VALIDATION_STATUS = z.enum(['passed', 'failed', 'needs_review'])

const ValidateBody = z.object({
  workspaceId: z.string().min(1),
  platform: PLATFORM,
  packId: z.string().min(1),
  output: z.string().min(1),
}).strict()

contentMemoryRoutes.post('/validate', async (c) => {
  const body = ValidateBody.parse(await c.req.json())
  const pack = getStack().contentMemory.getPack(body.packId)
  if (!pack) return c.json({ ok: false, error: 'pack_not_found' }, 404)
  const result = await getStack().validation.validate({
    workspaceId: body.workspaceId, platform: body.platform, contextPack: pack, output: body.output,
  })
  return c.json({ ok: true, result })
})

const RunBody = z.object({
  workspaceId: z.string().min(1),
  platform: PLATFORM.optional(),
  campaignId: z.string().min(1).optional(),
  agentId: z.string().min(1),
  workflowId: z.string().min(1).optional(),
  taskType: TASK_TYPE,
  userInput: z.string().min(1),
  intent: z.string().min(1),
  contextPackId: z.string().min(1).optional(),
  plan: z.string().optional(),
  output: z.string(),
  retrievedChunkIds: z.array(z.string()).optional(),
  retrievedDecisionIds: z.array(z.string()).optional(),
  retrievedExperienceMemoryIds: z.array(z.string()).optional(),
  retrievedSimilarityItemIds: z.array(z.string()).optional(),
  validationStatus: VALIDATION_STATUS,
  humanFeedback: z.string().optional(),
  errorType: z.string().optional(),
  errorSummary: z.string().optional(),
}).strict()

contentMemoryRoutes.post('/runs', async (c) => {
  const body = RunBody.parse(await c.req.json())
  const run = getStack().agentRuns.saveRun(body)
  return c.json({ ok: true, run }, 201)
})
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @anubis/content-memory build && pnpm vitest run packages/conversation/tests/content-memory-stack.test.ts`
Expected: PASS.

Run: `pnpm --filter @anubis/conversation typecheck && pnpm --filter @anubis/backend typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/conversation/src/index.ts packages/conversation/tests/content-memory-stack.test.ts packages/backend/src/content-memory.ts
git commit -m "feat(backend): output validation + agent-run trace routes"
```

---

## Task 9: Full verification

- [ ] **Step 1: Build the chain**

Run: `pnpm --filter @anubis/content-memory build && pnpm --filter @anubis/conversation build && pnpm --filter @anubis/backend build`
Expected: all succeed.

- [ ] **Step 2: Run suites**

Run: `pnpm vitest run packages/content-memory && pnpm vitest run packages/conversation`
Expected: all green (vendor the model for stack tests, or gate them).

- [ ] **Step 3: Repo-wide typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit (empty allowed)**

```bash
git add -A
git commit -m "test(content-memory): phase 5 validators + agent runs verified" --allow-empty
```

---

## Self-review

**Spec coverage (design §8 Phase 5 / original §16.4, §17, §20.1, §24):**
- `OutputValidator` + `ValidationResult`/`ValidationIssue` (original §17.1) → Task 1.
- Four MVP validators (original §17.2) → Tasks 2–4; aggregation → Task 5.
- Output-layer workspace isolation (original §20.1) → Task 2 (`WorkspaceLeakageValidator`).
- `agent_runs` trace (original §9.5) + `saveRun` (original §16.4) → Task 6.
- Validate output before human review (original §18 workflow) → Task 8 (`POST /content-memory/validate`).
- Approval/rejection back into memory (original §19) → reuses Phase 4 `POST /content-memory/feedback`.
- Traceability to sources (original §24.7) → `agent_runs` retrieved-id arrays + `context_pack_id`.

**Deliberately deferred:** validators-as-workflow-nodes and the durable rejection→regenerate loop (need the pending engine; they call the `ValidationService`/`ExperienceIndexService` seams built here). LLM-judge validators — the MVP four are documented heuristics.

**Type consistency:** `OutputValidator`/`ValidateInput`/`ValidationResult` defined in Task 1, implemented by all four validators (Tasks 2–4) and aggregated in Task 5; `Severity` reused from `src/types.ts`; `ContentContextPack` reused from Phase 3; `AgentRun`/`SaveAgentRunInput` consistent across repo (Task 6) and service (Task 6); migration versions `[8,9,11,12,13,14,15]` consistent across SQL filename, `CONTENT_MEMORY_MIGRATIONS`, and the index test.

**Placeholder scan:** none. The validators are explicitly heuristic (documented), not placeholders.

**MVP success criteria (original §24) now satisfied across Phases 1–5:**
1. Context pack for a brand/platform task → Phase 3.
2. Uses global + workspace knowledge → Phases 1, 3.
3. Retrieves similar approved content → Phase 2/3.
4. Sees rejected patterns separately → Phase 3 (§22.4 test).
5. Avoids previous workspace mistakes → Phase 4 recall + Phase 5 `RepeatedMistakeValidator`.
6. No cross-workspace leakage → Phase 1 isolation tests + Phase 5 `WorkspaceLeakageValidator`.
7. Output traceable to sources → Phase 5 `agent_runs`.

---

## Execution handoff

This completes the MVP phasing (1–5). Follow-on work, each its own plan:
- Workflow nodes (`Retrieval`/`ContextBuilder`/`lessonWriter`/`lessonReader`/validators) once the durable engine lands; they call the services built here.
- LLM-judge validators replacing the heuristic four.
- `knowledge_chunks` granularity, framework sub-taxonomy, `campaignContext`, confidence/reinforcement scoring.
- Frontend: brand-workspace management UI; surfacing validation issues at the human-review gate.
