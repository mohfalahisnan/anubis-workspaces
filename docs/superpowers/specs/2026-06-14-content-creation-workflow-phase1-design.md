# Content Creation Workflow — Phase 1 (`idea → human_review`)

**Date:** 2026-06-14
**Status:** Approved (design)

## Goal

Turn a validated content idea (saved into the Content Planner from the Research Phase)
into a structured, brand-aligned, AI-reviewed, human-reviewed draft brief — ready for
asset generation. This is the work that happens **after** a research candidate becomes a
Content Planner item with `status = "idea"` and **before** asset generation.

This document covers **Phase 1 only**: the AI text pipeline up to and including human
review, plus the lesson system, brand context, and a dedicated page. Asset generation
(`generating → draft`) is **Phase 2** and is explicitly out of scope here (it appears as
disabled placeholder UI).

The Research Phase is **not** rebuilt. The only addition on that side is a small bridge to
save a validated candidate into the Content Planner as an idea.

## Decisions (locked during brainstorming)

1. **Two phases.** Phase 1 = `idea → human_review` + lessons + page. Phase 2 = generation.
2. **AI steps reuse the existing CLI agent runner** (`AiAgentService.runAgent`), not direct
   LLM API calls. Prompts demand strict JSON, which we parse.
3. **One shared content model.** Extend `ContentItemStatus`; build a new dedicated page; the
   existing Content Planner keeps working.
4. **Auto-run, pausing at human review.** A single "Run" chains the AI steps; per-step
   manual re-runs remain available. AI rejection auto-loops back to brief, bounded.
5. **Transcript via `anubis-extractor`.** Video reference → download media → transcribe.
   Image/carousel → no OCR by default (optional manual button later).
6. **Lessons = simple SQLite filter** (project / niche / type / recency), not embeddings.
7. **Brand context = new per-project structured doc** (guideline, tone, audience, niche,
   content rules), injected into the brief step alongside lessons and optional KB hits.

## Status lifecycle

Extend `ContentItemStatus` (in `@anubis/shared`) from 7 to 12 values:

```
idea → raw_extracted → brief → content_refined → ai_review → human_review → generating → draft
```

plus the existing post-draft states `review, scheduled, published`, and `rejected`.

- AI review rejection and human rejection both set status back to `brief` (loop) and create a
  lesson.
- `generating` and everything after it are driven in **Phase 2**. In Phase 1, approving human
  review marks the item ready; it does **not** start generation yet.

Touched by the enum change: `packages/shared` type, the `ContentData` zod enum in
`content-items-repo.ts`, and the planner page `STATUSES` / `STATUS_LABEL` / `STATUS_TONE`
maps (the existing planner gains the new columns and keeps working).

## Data model

Additive, following the existing **markdown-canonical doc + SQLite side-table** split.

### ContentItem (existing markdown doc)
Stays the human-facing canonical record (title, status, references, human-readable
brief/draft sections). Add one field:
- `sourceCandidateId?` — the research candidate an idea was saved from (frontmatter).

### `content_pipeline` (new SQLite table, keyed by `content_id`)
Holds the structured pipeline artifacts as JSON. Mirrors `content_item_runtime`.

| column | type | notes |
|---|---|---|
| `content_id` | TEXT PK / FK | one row per content item |
| `raw_idea` | TEXT (JSON) | caption, assetRefs, sourceUrl, platform, competitor, mediaMetadata, transcript? |
| `improved_brief` | TEXT (JSON) | the brief fields (see below) |
| `refined_content` | TEXT (JSON) | caption, visualBrief, copywriting, hashtags, platformNotes |
| `ai_review` | TEXT (JSON) | decision, score?, checklist[], rejectionReason?, improvementInstruction? |
| `human_review` | TEXT (JSON) | decision, reason?, reviewedAt |
| `transcript` | TEXT | extracted transcript text (also referenced from raw_idea) |
| `transcript_source` | TEXT | e.g. `extractor`, or null |
| `auto_iteration_count` | INTEGER | brief→review auto-loop counter (loop guard) |
| `updated_at` | INTEGER | |

### `content_lessons` (new SQLite table)

| column | type |
|---|---|
| `id` | TEXT PK |
| `project_id` | TEXT |
| `content_id` | TEXT |
| `source` | TEXT — `ai_review` \| `human_review` \| `generation_failure` \| `final_draft_review` |
| `type` | TEXT — `brand_alignment` \| `tone_of_voice` \| `niche_alignment` \| `content_quality` \| `visual_quality` \| `copywriting_quality` \| `technical_generation_error` |
| `reason` | TEXT |
| `what_went_wrong` | TEXT |
| `how_to_improve` | TEXT |
| `related_brand_rule` | TEXT? |
| `related_tone_rule` | TEXT? |
| `related_niche_rule` | TEXT? |
| `created_at` | INTEGER |

`generation_failure` / `final_draft_review` sources are defined now but only produced in
Phase 2; Phase 1 produces `ai_review` and `human_review` lessons.

### Brand context (new per-project markdown doc)
A new document type `brand`, one doc per project (`knowledge/brand/<projectId>.md`), with
sections: **Brand Guideline, Tone of Voice, Target Audience, Niche Positioning, Content
Rules**. Editable from the new page (modal) and graphify-visible. Stored on-pattern with the
existing `MarkdownDocumentStore`.

## Pipeline engine (backend service)

A new `content-pipeline` service. Each **AI** step calls `AiAgentService.runAgent` with a
step-specific prompt that **demands a strict JSON block**. We extract the JSON robustly
(fenced ```json block, else first balanced `{…}`), validate with Zod, retry once on failure,
then surface an error if still invalid. AI steps run in a per-item scratch workspace under
the data dir. Model is configurable per step (default `claude`; AI review defaults to a
reasoning-capable model, `claude-opus`).

### Steps

1. **Raw extraction** (`idea → raw_extracted`, non-AI)
   Assemble the raw idea: caption, asset refs, source URL / platform / competitor, media
   metadata. If the reference media kind is **video** → download the media file, run
   `anubis-extractor` transcription, store transcript in `transcript` + `raw_idea`.
   Image/carousel → no OCR (optional manual button deferred).

2. **Breakdown → brief** (`raw_extracted → brief`, AI)
   Inject raw idea + brand context doc + recent relevant lessons (filter by
   project/niche/type, newest N) + optional KB search hits. The prompt answers the 10
   analysis questions and returns the improved-brief JSON:
   core idea, target audience, market fit, problem being solved, main message, content angle,
   hook direction, brand alignment notes, tone-of-voice direction, adaptation strategy, risk
   notes, reference lessons.

3. **Refine** (`brief → content_refined`, AI)
   Brief → refined-content JSON: **caption**; **visual brief** (concept, scene direction,
   subject, layout, mood, style, key visual elements, text overlay?, negative direction?);
   **copywriting** (hook, main body, CTA, optional text overlay, optional carousel slide
   copy, optional video script); **hashtags** (primary, niche, brand-safe, platform notes);
   **platform notes**.

4. **AI review** (`content_refined → ai_review`, AI)
   Runs the validation checklist (niche/brand/tone alignment, clarity, hook strength, message
   quality, audience relevance, visual-brief quality, copywriting quality, similarity risk,
   hallucination risk, misleading-claim risk, weak-differentiation risk). Returns
   `{ decision: approved|rejected, score?, checklist[], rejectionReason?, improvementInstruction? }`.
   - **Approved** → status `human_review`.
   - **Rejected** → create a lesson (`source=ai_review`), set status `brief`, increment
     `auto_iteration_count`, and (in auto-run) re-run brief→refine→review. **Loop guard:
     max 3 auto-iterations**, then stop and wait for human attention.

5. **Human review** (page action, not auto)
   - **Approve** → marks ready (Phase 2 will move to `generating`).
   - **Reject** → **requires a reason**, creates a lesson (`source=human_review`), status →
     `brief`.

### Auto-run orchestration
A single "Run to human review" action starts a **background job** (reuse `jobManager`) that
chains steps 1→4, persisting each status transition as it happens; the frontend polls job
progress. Per-step manual re-run endpoints also exist for inspecting/editing between steps.

## Backend routes (extend `content-items`)

- `POST /content-items/from-candidate` — **bridge**: save a validated research candidate as
  an `idea` (carries `sourceCandidateId`, score, candidateLevel, nicheAligned, reference).
- `POST /content-items/:id/extract` — raw extraction (+ transcript).
- `POST /content-items/:id/pipeline/run` — start the auto-run job → `{ jobId }`.
- `POST /content-items/:id/pipeline/step/:step` — re-run a single step.
- `GET  /content-items/:id/pipeline` — fetch structured artifacts.
- `POST /content-items/:id/human-review` — `{ decision, reason? }`.
- `GET  /content-items/:id/lessons` and `GET /lessons?projectId=` — lesson retrieval.
- `GET/PUT /brand-context?projectId=` — brand context doc.

Request bodies validated with Zod; errors normalized by the existing `app.ts` handler
(`ZodError → 400`, else 500). Route ordering: static segments (`/from-candidate`) registered
before `/:id` to avoid shadowing.

## Frontend — new dedicated page "Content Studio"

Registered following the add-page checklist (sidebar data, `navigation.tsx` `itemRoute()` +
`CurrentPage()`, route wiring — the silent default branches mean a missing case opens Home
with no typecheck error, so all spots must be updated).

Layout: a per-item workspace. **Left rail** = Content Planner ideas + in-progress items
(title, source competitor, platform, candidate level, research score, niche alignment,
created date, status). **Main** = the selected item's pipeline with sections matching the
spec:

- **Raw Idea Preview** — caption, assets, transcript (if video), source URL, competitor data,
  research metadata. Actions: extract transcript, refresh raw data, continue.
- **AI Breakdown / Improved Brief** — the brief fields + lessons used. Actions: regenerate,
  edit manually, continue to refine.
- **Refined Content** — caption, visual brief, copywriting, hashtags, platform notes.
  Actions: regenerate section, edit, send to AI review.
- **AI Review** — decision, score, checklist, rejection reason, lesson created. Actions:
  approve/reject manually, send back to brief, continue to human review.
- **Human Review** — final refined content, AI review result, checklist, lesson history.
  Actions: approve, reject with reason, send to generation (Phase 2, disabled).
- **Generation Queue** and **Draft Output** — **disabled Phase-2 placeholders**.
- **Lesson History** — lessons for this item (and a global lessons view).

Top-level controls: "Run to human review", per-step re-run, edit-artifact, approve/reject.
A **Brand Context editor** (modal) edits the per-project brand doc. The existing Content
Planner page remains the kanban / tracking view.

## Out of scope (Phase 2)

`generating` execution, the generation orchestrator, capability-routed generators
(image/carousel/video/audio/voiceover/text-overlay/caption/hashtags), the live generation
queue, draft stitching, and the populated Draft Output. These get their own spec.

## Testing

Vitest unit tests with `runAgent` mocked:
- JSON extraction/validation (fenced + balanced-brace, retry-once).
- Each step transition (idea→raw_extracted→brief→content_refined→ai_review→human_review).
- Lesson creation on AI rejection and human rejection.
- Auto-loop guard (stops after 3 iterations).
- Raw extraction with mocked transcript (video) and skip-OCR (image/carousel).
- `content_pipeline`, `content_lessons`, and brand-context repos.

Backend route tests following `packages/backend/tests/content-items.test.ts`.

Operational notes (from project memory): rebuild changed packages before running vitest
(vitest resolves `@anubis/*` to `dist`); run with `--maxWorkers=2` to avoid worker
contention. Any new third-party runtime import must also be added to the **root**
`package.json` dependencies for the packaged build.
