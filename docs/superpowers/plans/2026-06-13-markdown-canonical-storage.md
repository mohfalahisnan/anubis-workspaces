# Markdown-Canonical Project Storage Implementation Plan

**Design:** `docs/superpowers/specs/2026-06-13-markdown-canonical-storage-design.md`
**Issue:** #39

## Phase 1: Shared Filesystem Foundation

1. Add a Project workspace resolver that assigns and persists deterministic managed workspaces when `workdir` is missing.
2. Extend workspace initialization with task status directories and canonical content/research directories.
3. Add a shared Markdown document store for scanning, validation, duplicate detection, atomic writes, safe deletion, slugs, timestamps, and unknown metadata preservation.
4. Add tests for workspace initialization and document-store behavior.

## Phase 2: Tasks

1. Replace task SQLite persistence with Markdown repository operations.
2. Map task descriptions to the Markdown body and structured fields to frontmatter.
3. Move files when status changes and validate directory/frontmatter agreement.
4. Preserve the current task route contract and reference validation.
5. Add API tests that manually edit a task file and observe the change on the next request.

## Phase 3: Competitors and Operational Anchors

1. Replace competitor authored-field persistence with Markdown documents.
2. Keep minimal SQLite anchor rows and capture-derived runtime fields.
3. Merge Markdown and runtime data in repository reads.
4. Ensure manually created competitor files receive anchors before captures reference them.
5. Update competitor, capture, research, snapshot, and cron tests.

## Phase 4: Content and Analytics

1. Replace content authored-field persistence with Markdown documents.
2. Add an operational content analytics table keyed by content document ID.
3. Preserve current content API shapes and workflow-created content behavior.
4. Preserve unknown Markdown sections during field updates.
5. Add direct-edit and analytics-separation tests.

## Phase 5: Curated Research

1. Add shared curated-research types.
2. Add a Markdown-backed curated research repository.
3. Add CRUD routes under `/research/documents`.
4. Add candidate-promotion behavior and evidence references.
5. Test that operational sessions remain SQLite-backed.

## Phase 6: Schema Cleanup and Verification

1. Add a development-reset migration that removes obsolete task/content canonical tables and creates operational content analytics storage.
2. Keep competitor anchor storage because existing operational foreign keys depend on it.
3. Run focused tests, package typechecks, and the full test suite where feasible.
4. Run `graphify update .`.
5. Review the final diff for correctness, readability, architecture, security, and performance.

## Acceptance Tests

- Creating each canonical domain through HTTP creates a readable Markdown file.
- Editing that file manually changes the next API response without a sync operation.
- Task status updates move files between status directories.
- Renaming a document does not change its identity or operational relationships.
- Invalid and duplicate documents produce actionable errors.
- Competitor captures and research candidates continue working through stable IDs.
- Content analytics update without becoming canonical document fields.
- Curated research promotion creates a Knowledge Base-indexable document.
- Document writes do not trigger Knowledge Base indexing.
- Conversations, workflows, captures, and research execution remain SQLite-backed.
