# Content Studio pipeline as an executable workflow

- **Date:** 2026-06-17
- **Status:** Approved (design)
- **Topic:** Replicate the hardcoded Content Studio content-creation pipeline as a runnable workflow-runtime graph, reusing existing nodes and adding one new node where none exists.

## Goal

Produce an **importable workflow** that mirrors the Content Studio pipeline
(`extract → breakdown → refine → ai_review → human_review → generation → draft`)
inside the `@anubis/workflow-runtime` node system. Reuse existing node types
wherever one fits; create a new node type only for the one task with no existing
node (AI auto-review with branch + loop).

## Decisions

Settled with the user before design:

1. **Scope:** full pipeline (extract through draft), not a subset.
2. **AI review:** build a new `aiReviewGate` node (an AI that branches
   approved/rejected and drives the auto-loop). Existing nodes only branch via
   human input (`humanApproval`).
3. **Deliverable form:** a portable workflow export JSON, imported via
   `POST /workflows/import`.
4. **Image generation:** reuse `aiAgentConversation` pointed at a codex
   `$imagegen`-style profile (matches Content Studio's default image generator;
   no Google Flow / headed-Chrome dependency). *Not* `flowImage`.
5. **Surface:** build both backend (executor) and frontend (editor node + palette
   + inspector) so the imported workflow runs *and* renders/edits cleanly.

## Background

- **Content Studio** is a hardcoded two-phase pipeline in
  `packages/backend/src/content-pipeline/*` (extract → breakdown → refine →
  ai_review → human_review, with the AI review auto-looping back to refine up to
  `maxAutoIterations = 3`) and `packages/backend/src/content-generation/*`
  (derive tasks → generate caption/hashtags/image/video → stitch draft). It runs
  the selected profile's agent at each step.
- **workflow-runtime** (`packages/workflow-runtime/src`) is a node graph executor.
  The runner (`runner.ts`) is a frontier scheduler. Two mechanics matter here:
  - **Branching** (`selectedBranch`, `runner.ts:17`): a node activates only the
    matching outgoing branch *iff* its output is `{ kind: 'approval', decision:
    'approved' | 'rejected' }`. No other node kind branches.
  - **Bounded loop** (`rearm`, `runner.ts:92`): a back-edge marked
    `data.loop: true` from a `loopSource` node back to a re-entry `target` re-runs
    the region downstream of `target`. The iteration cap is read from the node
    that feeds `loopSource` on its `rejected` branch
    (`...data.maxIterations`, default 3). The `loopSource`'s own output is
    preserved across iterations so the re-entry node can read it.

The canonical loop shape already used in the codebase is
`approval-node --rejected--> lessonWriter --loop--> re-entry`. Because the runner
keys branching and the loop cap on the **`approval` envelope shape**, a new
AI-driven gate that emits that exact shape plugs into both mechanics with **zero
runner changes**.

## The new node: `aiReviewGate`

A single new executor. It is `aiAgentConversation` that returns an `approval`
envelope instead of an `aiAgent` envelope.

### Config (Zod)

```ts
{
  profileId: string,                 // min 1 — which agent runs the review
  prompt: string,                    // min 1 — the review checklist/instructions
  reasoning?: 'minimal'|'low'|'medium'|'high',
  titleTemplate?: string,            // default "Workflow · {nodeId}"
  maxIterations?: number,            // int, 1..20, default 3 — read by runner.rearm()
}
```

### Behaviour

1. Compose the agent message from upstream context + `prompt` (same composition
   `aiAgentConversation` uses — see "Shared composition" below).
2. `ctx.conversations.createAndAwaitFirstTurn(...)`.
3. `parseEnvelope(reply)` (the existing `anubis-output` fenced-block parser).
4. Read the verdict from `envelope.data.decision`:
   - `'approved'` → `decision: 'approved'`
   - anything else (including missing/malformed) → `decision: 'rejected'`, so a
     parse failure self-corrects via the loop rather than crashing the run. The
     reason is surfaced in `notes`.
5. Return, mirroring `HumanApprovalOutput` plus a `review` payload:

```ts
{
  kind: 'approval',
  decision: 'approved' | 'rejected',
  notes?: string,                    // rejectionReason / improvementInstruction
  text: string,                      // improvement instruction — fed to lessonWriter on reject
  reviewed: Record<string, unknown>, // upstream, passed through so the approved branch keeps the refined content
  review: unknown,                   // full parsed review (score, checklist, ...)
}
```

The `kind: 'approval'` makes `selectedBranch` activate the matching branch, and
makes `rearm` read this node's `maxIterations` as the loop cap.

### Shared composition

`aiAgentConversation`'s `composeMessage` / `buildOutputSpec` /
`buildWorkflowContext` are module-private. To avoid duplication, extract them into
`packages/workflow-runtime/src/executors/_compose.ts` and import from both
executors. Also add an `aiReviewGate` entry to `DOWNSTREAM_CONTRACTS` (so an
upstream `aiAgentConversation` feeding the gate — i.e. `refine` — knows to emit a
`data.decision` verdict): *"Populate `data.decision` with 'approved' or
'rejected', plus optional `score`, `checklist`, `rejectionReason`,
`improvementInstruction`. Include `text` summarising the verdict."*

## The graph (the deliverable)

Eleven nodes; ten reused, one new. Targets an **image post** by default; video is a
one-node swap (see Generation).

| id | type | reused | Content Studio equivalent |
|----|------|--------|---------------------------|
| `ig` | `instagramPost` | ✅ | extract — load reference post (caption + media) |
| `breakdown` | `aiAgentConversation` | ✅ | breakdown → ImprovedBrief |
| `refine` | `aiAgentConversation` | ✅ | refine → RefinedContent (**loop re-entry**) |
| `review` | **`aiReviewGate`** | 🆕 | ai_review — approve/reject + auto-loop |
| `lesson` | `lessonWriter` | ✅ | record rejection reason; loops back to `refine` |
| `human` | `humanApproval` | ✅ | human_review gate |
| `image` | `aiAgentConversation` | ✅ | generation — visual (codex `$imagegen` profile) |
| `caption` | `jsonTransformer` | ✅ | generation — final caption + hashtags |
| `preview` | `instagramDraftPreview` | ✅ | draft — preview the post |
| `planner` | `savePlanner` | ✅ | draft — save to Content Planner (status `review`) |
| `capture` | `outputCapturer` | ✅ | draft — write draft JSON artifact |

### Edges

```
ig          → breakdown
breakdown   → refine
refine      → review
review  --approved--> human
review  --rejected--> lesson
lesson  --loop(data.loop:true)--> refine     # cap = review.maxIterations (3)
human   --approved--> image
human   --approved--> caption
image       → preview
caption     → preview
image       → planner
preview     → capture
# human --rejected--> (no edge): approved branch dies, generation cluster skips,
#   run ends cleanly. Optional: a terminal lessonWriter to record the human reason.
```

### Loop semantics (verified against `runner.ts`)

- `rearm` is triggered by `lesson`'s outgoing loop edge. `loopSource = lesson`,
  `target = refine`. The cap is read from the node feeding `lesson` on `rejected`
  = `review`, i.e. `review.data.maxIterations`. ✔
- `downstreamRegion(refine)` = `{refine, review, lesson, human, image, caption,
  preview, planner, capture}`. On each loop these reset to `pending`; all outputs
  cleared **except `lesson`** (preserved so `refine` reads the new lesson). ✔
- `breakdown` is upstream of `refine`, so it is **not** re-run; the brief persists
  and the `breakdown → refine` edge stays active, keeping `refine` ready. ✔
  (Intentional fidelity tweak vs. Content Studio, which re-runs breakdown too —
  this is cleaner and the brief is unchanged anyway.)

## Generation phase specifics

- **`image`** — `aiAgentConversation` with a codex image profile (default
  `codex-image`). Prompt instructs the agent to generate the visual from the
  refined `visualBrief` (carried in `human.reviewed`) and return the saved file
  path(s) in the envelope `paths`. Output `paths` flow to `preview`/`planner`.
- **Video swap** — replace the `image` node's prompt + profile (`codex-video`) to
  produce an MP4 via the hyperframes-style agent; identical wiring. Documented, not
  in the default graph.
- **`caption`** — `jsonTransformer` reads the refined content from `human.reviewed`
  and emits `{ caption, hashtags }` for the draft preview.
- **Draft assembly** — `instagramDraftPreview` renders the post; `savePlanner`
  persists it to the Content Planner with status `review`; `outputCapturer` writes
  a `.json` draft artifact (the stitched-draft analogue).

## Profile configuration

The AI node `profileId`s (`breakdown`, `refine`, `review`, `image`) are set per
node. The exported JSON uses documented placeholder/default profile ids
(`codex-image` for the image node; a general profile for the text steps). The user
sets real ids in the inspector after import, or overrides them per run via
`POST /workflows/:id/runs` `nodeDataOverrides`. The spec does not hardcode the
user's profile ids.

## Frontend (editor) pieces

Mirror `humanApproval` (branching node) + `aiAgentConversation` (AI config):

- **Node component** — `executable-nodes/ai-review-gate.tsx`: a `NodeShell` with
  `ApprovalHandles` (approved/rejected output handles), run-status badge, and a
  short config summary. No approve/reject buttons (the AI decides).
- **Registry + palette** — register in `executable-nodes/index.ts`
  (`executableNodeTypes['aiReviewGate']`) and add to `NODE_PALETTE` under the
  `agent` category (label e.g. "AI Review").
- **Inspector config form** —
  `inspector/config/ai-review-gate-config.tsx` (fields: profile picker, prompt,
  reasoning, maxIterations — model on `ai-agent-conversation-config` +
  `human-approval-config`), registered in `inspector-panel.tsx` `CONFIG_FORMS`.

Without these, the editor renders the node blank and shows *"No config form for
type aiReviewGate"*; with them it renders and edits like any built-in node.

## Files

**Create**
- `packages/workflow-runtime/src/executors/ai-review-gate.ts`
- `packages/workflow-runtime/src/executors/_compose.ts` (extracted shared helpers)
- `packages/frontend/src/components/workflow-editor/executable-nodes/ai-review-gate.tsx`
- `packages/frontend/src/components/workflow-editor/inspector/config/ai-review-gate-config.tsx`
- `workflows/content-studio.workflow.json` (the importable export envelope)
- `packages/workflow-runtime/tests/ai-review-gate.test.ts`
- `packages/workflow-runtime/tests/content-studio-graph.test.ts` (full-graph run)

**Modify**
- `packages/workflow-runtime/src/executors/index.ts` (register `aiReviewGate`;
  re-export)
- `packages/workflow-runtime/src/executors/ai-agent-conversation.ts` (use
  `_compose.ts`; add `aiReviewGate` downstream contract)
- `packages/frontend/src/components/workflow-editor/executable-nodes/index.ts`
  (`executableNodeTypes` + `NODE_PALETTE`)
- `packages/frontend/src/components/workflow-editor/inspector-panel.tsx`
  (`CONFIG_FORMS`)

## Testing / verification

1. **Unit — `aiReviewGate`** (stub `ctx.conversations`): approved verdict → output
   `decision:'approved'` + `reviewed` passthrough; rejected verdict → `'rejected'`
   + `notes`/`text` from the review; malformed envelope → defaults to `'rejected'`.
2. **Integration — full graph** through `runWorkflow` with stubbed agent +
   approval: (a) refine approved on first pass → reaches generation/draft;
   (b) refine rejected N times → loops, stops at `maxIterations`, run status
   `rejected`; (c) human rejects → generation cluster skipped, run ends.
3. **Build** `@anubis/workflow-runtime` then `@anubis/frontend`; `pnpm typecheck`.
4. **Import + render** — `POST /workflows/import` with
   `workflows/content-studio.workflow.json`; open it in the editor and confirm all
   11 nodes render (the `aiReviewGate` node with config form) and the loop edge is
   present.

## Out of scope / notes

- **Dynamic task derivation:** Content Studio derives a variable task set per
  `mediaKind` at runtime. A static graph can't; the default graph is the
  image-post path, with video as a documented swap. Carousel (per-slide images) is
  not modelled.
- **content-memory / knowledge-base context packs** used by Content Studio steps
  are not wired into workflow AI nodes yet (see existing memory note); the workflow
  nodes rely on prompt + upstream context only.
- No runner changes. No DB migrations (workflows import into the existing
  `workflows` table as a draft).
