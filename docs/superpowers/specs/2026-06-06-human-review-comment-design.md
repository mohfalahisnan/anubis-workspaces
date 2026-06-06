# Human Review Comment + Markdown Passthrough — Design

**Date:** 2026-06-06
**Status:** Approved (design)
**Scope:** Add a reviewer comment to the Human Review (humanApproval) workflow node,
surface that comment explicitly to the Lesson Writer, and fix the Markdown node
rendering empty after approval.

## Problem

In the workflow editor, the Human Review node pauses a run for an approve/reject
decision. Three gaps:

1. **No comment field.** The approve/reject UI
   (`human-approval.tsx`) calls `decide(runId, { nodeId, decision })` with no
   `notes`, so the reviewer can't say *why* something was rejected. The backend
   already accepts and threads `notes` end-to-end
   (`WorkflowRunManager.decide` → `node-decided` event → executor output), so only
   the UI is missing.
2. **Markdown renders empty.** The approval node outputs
   `{ kind:'approval', decision, notes?, reviewed:{…} }` — no top-level `text`, and
   the real content sits two levels deep under `reviewed`.
   `markdown-display.ts`'s `findFirstText` only checks for a string value or a
   `value.text` string, finds neither, and falls back to `''`.
3. **Comment not surfaced to the Lesson Writer.** On reject, the Lesson Writer
   (`mistake`) receives the approval output (incl. `notes`) as upstream JSON, so the
   comment *technically* reaches it — but buried in a JSON blob, not called out.

## Decisions

- **Comment field:** a single textarea in the node's `awaiting` state, used for both
  decisions. **Reject is disabled until a comment is typed**; Approve's comment is
  optional.
- **Markdown after approve:** render the **approved content only** (the reviewed
  text). The comment is not shown in Markdown.
- **Lesson Writer:** surface the reviewer comment **explicitly** as a labeled block in
  the prompt.
- **Markdown fix approach:** the approval node surfaces the approved `text` at the top
  level (Approach A), so Markdown's existing logic renders it unchanged. Rejected:
  patching only `markdown-display` to recurse into nested objects (fuzzier, narrower);
  changing branch/scheduler semantics to pass upstream through transparently (risky).

## Components

### `packages/workflow-runtime/src/executors/_text.ts` (new)
`firstUpstreamText(upstream: Record<string, unknown>): string | null` — returns the
first string value, or the first `value.text` string, else null. This is exactly
`markdown-display.ts`'s current `findFirstText`, extracted for reuse.

### `packages/workflow-runtime/src/executors/markdown-display.ts`
Delete the local `findFirstText`; import `firstUpstreamText` from `_text.js`. Behavior
unchanged.

### `packages/workflow-runtime/src/executors/human-approval.ts`
- `HumanApprovalOutput` gains `text: string`.
- `run` returns `text: firstUpstreamText(input.upstream) ?? ''` alongside the existing
  `decision`, `notes?`, and `reviewed`.
- **Data flow:** approve → Markdown's upstream value now has `.text` (the approved
  content) → renders it. `notes`/`reviewed` passthrough unchanged.

### `packages/workflow-runtime/src/executors/lesson-writer.ts`
- Add a local `reviewerComment(upstream)` helper: scan `Object.values(upstream)` for an
  object with `kind === 'approval'` and a non-empty string `notes`; return it trimmed,
  else null.
- When present, inject a `<reviewer-comment>\n{comment}\n</reviewer-comment>` block into
  the prompt content (between the context blocks and the output-format instruction).
- Adjust `DEFAULT_PROMPTS.mistake` to reference it: "…capturing the mistake and the rule
  to avoid it next time; use the reviewer's comment as the primary reason. Put the
  lesson in the `text` field." `lesson` prompt unchanged.

### `packages/frontend/src/components/workflow-editor/executable-nodes/human-approval.tsx`
- Add `notes` state and a textarea (class includes `nodrag`) in the `awaiting` branch,
  above the buttons. Placeholder: "Comment (required to reject)…".
- `decide(decision)` early-returns if `decision === 'rejected' && !notes.trim()`, and
  sends `notes: notes.trim() || undefined`.
- **Reject** button `disabled={busy || !notes.trim()}`; **Approve** stays
  `disabled={busy}`.

## Testing

- **`_text` helper** (`tests/executors/_text.test.ts`): string value → returns it;
  `{text}` value → returns text; neither → null.
- **`human-approval.test.ts`**: extend the approved-case assertion to include
  `text: 'draft'` (from `upstream: { x: { text: 'draft' } }`); add a case with
  non-text upstream → `text: ''`.
- **`lesson-writer.test.ts`**: capture the `content` passed to
  `createAndAwaitFirstTurn` via a spy; assert it contains `<reviewer-comment>` and the
  notes string when an approval upstream carries `notes`; assert no comment block when
  `notes` is absent.
- **Frontend**: typecheck + manual verification — Reject is disabled until a comment is
  typed; Approve sends optional `notes`; after approve the Markdown node renders the
  approved content; after reject the mistake Lesson Writer's lesson reflects the
  comment.

## Out of scope

- Showing the comment inside the Markdown node (approved content only).
- Editing/important changes to the approve/reject UI beyond the textarea + disable rule.
- Persisting the comment anywhere beyond the existing run-step/output flow.
- A new conversation status or schema migration.
