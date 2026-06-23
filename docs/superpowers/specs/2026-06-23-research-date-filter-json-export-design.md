# Research page — date filter + detailed JSON export

_Date: 2026-06-23 · Status: approved_

## Goal

On the **Research** page (`packages/frontend/src/pages/research.tsx`, the scored
post-candidate list), add:

1. A **date filter** over the displayed candidates (by `postedAt`).
2. An **Export JSON** button that downloads the currently-filtered candidates as
   detailed-post JSON.

Scope is limited to the Research page. The Content and Competitors pages, the
existing project Snapshot export, CSV, and run-level `dateFrom`/`dateTo` controls
are out of scope.

## Approach decisions

- **Date filter = client-side display filter** over the `candidates` already held
  in page state + localStorage. Mirrors the existing Valid/Level segmented filters
  (also client-side) and composes with them and the score sort. Run-level
  `ResearchControls.dateFrom/dateTo` are intentionally left unused (YAGNI).
- **Export = pure client-side Blob download**, reusing the same download mechanics
  as `snapshot-io-buttons.tsx`. `ResearchCandidateSummary` is already a detailed
  post, and candidates live in the frontend, so no backend route is needed.

## Date filter

- Presets: **All / 7d / 30d / 90d** — keep candidates whose `postedAt` is within N
  days of "now".
- **Custom From–To** date inputs (`<input type="date">`), inclusive bounds on
  `postedAt`. Choosing a custom bound switches the preset to `custom`; choosing a
  preset clears the custom bounds. `All` = no date constraint.
- Candidates with a missing/unparseable `postedAt` are **hidden while any date
  filter is active**, and shown under `All`.

## Export JSON

- Button in the header actions (next to Run research / Refresh).
- Exports the **currently-visible candidates** (after validation + level + date
  filters) — i.e. exactly what the table shows.
- Each entry = the full `ResearchCandidateSummary` plus a `competitor` block
  (handle, displayName, niche, followers, avgLikes, baselineLikes, level) resolved
  from `competitorById`.
- File envelope: `{ kind: 'anubis-research-export', schemaVersion: 1, exportedAt,
  project, filters: { date, validation, level }, count, posts }`.
- Filename: `anubis-research-<project-slug>-<yyyymmdd>.json`.
- Disabled when there are no visible candidates.

## Units (pure & testable)

- `packages/frontend/src/lib/research.ts` (extend): `DatePreset`, `DateFilterState`,
  `DEFAULT_DATE_FILTER`, `resolveDateBounds(state, now)`, `filterCandidatesByDate(candidates, state, now)`.
- `packages/frontend/src/lib/research-export.ts` (new): `ResearchExportFile`,
  `ResearchExportPost`, `buildResearchExport({ candidates, competitorById, project, filters })`.
- `research.tsx` stays thin: holds `dateFilter` state, renders the controls + Export
  button, and wires the helpers.

## Testing

- `tests/lib/research.test.ts` (extend): date-bound resolution and candidate
  filtering — inclusive bounds, preset windows, missing `postedAt`.
- `tests/lib/research-export.test.ts` (new): export envelope shape, competitor
  enrichment, only filtered candidates included.
- `tests/pages/research.test.tsx` (extend): Export button renders; the date filter
  narrows visible rows.
