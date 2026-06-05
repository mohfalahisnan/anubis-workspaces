# Content memory — context packs, validation, experience

Brand-scoped content memory: build an AI-ready **context pack** for a brand + platform task,
validate generated output against it, persist a run trace, and feed reviewer feedback back as
learnable experience. Backed by `@anubis/content-memory`.

Two concepts drive every call:

- **`workspaceId`** — the *brand* workspace (a `brand_workspaces` row). The well-known default
  brand is `"default-workspace"`. Everything is scoped to one brand; never mix brands.
- **`platform`** — one of `instagram | tiktok | youtube | facebook | linkedin | x | threads |
  general`. Only `instagram` is populated today.

## Endpoints

| Method | Path | Purpose | Source |
| --- | --- | --- | --- |
| POST | `/content-memory/context-pack` | Build + persist a context pack for a task | `content-memory.ts:25` |
| POST | `/content-memory/validate` | Validate an output string against a saved pack | `content-memory.ts:68` |
| POST | `/content-memory/runs` | Persist an agent-run trace | `content-memory.ts:100` |
| POST | `/content-memory/feedback` | Record reviewer feedback as an experience memory | `content-memory.ts:48` |
| POST | `/content-memory/memories/:id/promote` | Promote a candidate memory to active | `content-memory.ts:54` |

All bodies are Zod `.strict()` (unknown keys → 400). Errors use the standard envelope
(`{ ok: false, error: { code, message, issues } }`).

## POST `/content-memory/context-pack`

Build the pack you condition generation on. It assembles brand context, platform context,
**separated** similar-content buckets (approved / competitor / rejected — rejected is "patterns
to avoid", never a target), global frameworks, workspace rules, recalled experience, citations,
and a `finalInstruction`.

```ts
{
  workspaceId: string                 // required, min 1 — e.g. 'default-workspace'
  platform: Platform                  // required
  taskType: 'analyze_competitor' | 'build_brief' | 'generate_content'
          | 'rewrite_content' | 'review_content' | 'create_calendar'
  query: string                       // required — what to retrieve against
  objective: string                   // required — the human goal, echoed into finalInstruction
  campaignId?: string
  limitPerBucket?: number             // int 1..20, default 3
}
```

Example:

```bash
curl -s -X POST "$BASE/content-memory/context-pack" \
  -H 'Content-Type: application/json' \
  -d '{"workspaceId":"default-workspace","platform":"instagram","taskType":"generate_content","query":"gentle skincare routine","objective":"Write an Instagram caption"}'
```

Response: `{ ok: true, packId, pack }`. **Keep `packId`** — `/validate` and `/runs` reference it.
Use `pack.brandContext`, `pack.workspaceRules.mustAvoid`, `pack.similarContent.approved` (good
examples), `pack.similarContent.rejected` (avoid these), and `pack.finalInstruction` to write.

## POST `/content-memory/validate`

Heuristic safety check before showing output to a human. Loads the saved pack by `packId`,
then runs four validators (workspace-leakage = critical, brand-rule = high, repeated-mistake =
high, platform-rule = medium).

```ts
{
  workspaceId: string                 // the active brand
  platform: Platform
  packId: string                      // from /context-pack
  output: string                      // the generated text to check
}
```

```bash
curl -s -X POST "$BASE/content-memory/validate" \
  -H 'Content-Type: application/json' \
  -d '{"workspaceId":"default-workspace","platform":"instagram","packId":"'"$PACK"'","output":"Your evening glow routine ✨"}'
```

Response: `{ ok: true, result }` where `result = { passed: boolean, severity?, issues: [{ type,
message, relatedMemoryId?, suggestedCorrection? }] }`. `404 { ok:false, error:'pack_not_found' }`
if the `packId` is unknown. If `passed` is false, fix the output using each issue's
`suggestedCorrection` (and never name another brand — that's a critical `workspace_leakage`).

## POST `/content-memory/runs`

Persist a traceable record of the task. `201` on success.

```ts
{
  workspaceId: string                 // required
  agentId: string                     // required — who produced this
  taskType: <same enum as context-pack>
  userInput: string                   // required
  intent: string                      // required
  output: string                      // required (may be empty string)
  validationStatus: 'passed' | 'failed' | 'needs_review'   // required
  platform?: Platform
  campaignId?: string
  workflowId?: string
  contextPackId?: string              // link back to the pack
  plan?: string
  retrievedChunkIds?: string[]
  retrievedDecisionIds?: string[]
  retrievedExperienceMemoryIds?: string[]
  retrievedSimilarityItemIds?: string[]
  humanFeedback?: string
  errorType?: string
  errorSummary?: string
}
```

```bash
curl -s -X POST "$BASE/content-memory/runs" \
  -H 'Content-Type: application/json' \
  -d '{"workspaceId":"default-workspace","agentId":"content-agent","taskType":"generate_content","userInput":"caption for the serum","intent":"generate","output":"…","validationStatus":"needs_review","contextPackId":"'"$PACK"'"}'
```

Response: `{ ok: true, run }`.

## POST `/content-memory/feedback`

Turn a reviewer verdict into a learnable memory. By default a `good` rating records **nothing**;
`bad`/`partial` create a *candidate* memory (a `mistake` for `bad`, else a `lesson`). Candidates
do not affect future packs until promoted.

```ts
{
  runId: string                       // required — ties feedback to a run
  workspaceId: string                 // required
  rating: 'good' | 'bad' | 'partial'  // required
  feedback: string                    // required — the reviewer's note
  platform?: Platform
  createExperienceMemory?: boolean     // override the default rule
  memoryType?: 'mistake' | 'correction' | 'workflow_rule' | 'validation_rule'
             | 'preference' | 'anti_pattern' | 'lesson'
  severity?: 'low' | 'medium' | 'high' | 'critical'
}
```

```bash
curl -s -X POST "$BASE/content-memory/feedback" \
  -H 'Content-Type: application/json' \
  -d '{"runId":"'"$RUN"'","workspaceId":"default-workspace","rating":"bad","feedback":"This brand never uses fear-based hooks."}'
```

Response: `{ ok: true, memory }` (`memory` is `null` when nothing was created).

## POST `/content-memory/memories/:id/promote`

Promote a candidate memory to `active` so it is recalled into future context packs and checked
by the repeated-mistake validator. Use the `memory.id` returned by `/feedback`.

```bash
curl -s -X POST "$BASE/content-memory/memories/$MEMORY_ID/promote"
```

Response: `{ ok: true }`.

## Workflow — generate, validate, learn

```bash
# 1. Build the pack (capture packId)
PACK=$(curl -s -X POST "$BASE/content-memory/context-pack" \
  -H 'Content-Type: application/json' \
  -d '{"workspaceId":"default-workspace","platform":"instagram","taskType":"generate_content","query":"serum launch","objective":"Write a launch caption"}' \
  | jq -r .packId)

# 2. Write the caption from the returned pack (brand context, approved examples,
#    mustAvoid rules, rejected patterns, finalInstruction). Then validate it:
curl -s -X POST "$BASE/content-memory/validate" \
  -H 'Content-Type: application/json' \
  -d '{"workspaceId":"default-workspace","platform":"instagram","packId":"'"$PACK"'","output":"<your caption>"}'

# 3. Persist the run (link the pack)
RUN=$(curl -s -X POST "$BASE/content-memory/runs" \
  -H 'Content-Type: application/json' \
  -d '{"workspaceId":"default-workspace","agentId":"content-agent","taskType":"generate_content","userInput":"serum caption","intent":"generate","output":"<your caption>","validationStatus":"needs_review","contextPackId":"'"$PACK"'"}' \
  | jq -r .run.id)

# 4. After human review, record the verdict (and promote the memory if it should stick)
curl -s -X POST "$BASE/content-memory/feedback" \
  -H 'Content-Type: application/json' \
  -d '{"runId":"'"$RUN"'","workspaceId":"default-workspace","rating":"bad","feedback":"Avoid clinical claims."}'
```

If `validate` fails, revise the output and re-validate before saving the run as `passed`.
Brand isolation is strict: output must never reference a *different* brand workspace's name.
