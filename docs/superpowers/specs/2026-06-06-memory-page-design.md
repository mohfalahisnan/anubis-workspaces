# Memory page — experience-memory list + agent-run log

**Date:** 2026-06-06
**Status:** Approved (design)

## Problem

The content-memory backend exposes only write/action endpoints under
`/content-memory/*` (`context-pack`, `feedback`, `memories/:id/promote`,
`validate`, `runs`). There is no way to **read** experience memories or the
agent-run history over HTTP, and there is no frontend surface for either.
Candidate memories (the ones awaiting `promote`) are completely invisible
today — `ExperienceMemoriesRepo` only offers `recallActive` (active/reinforced,
platform-filtered) and `findById`.

Goal: a workspace-scoped UI that **lists** experience memories (all statuses,
with a promote action) and displays the **agent-run log**.

## Decisions

- **List scope:** all experience memories regardless of status
  (candidate / active / reinforced / deprecated), with a status filter and a
  **Promote** button on candidates. Include workspace-scoped *and* global
  memories.
- **Log:** the `agent_runs` history.
- **Placement:** a new top-level "Memory" nav page with two tabs
  (Memories, Run Log), scoped to the active workspace.
- **API shape:** two focused GET endpoints (approach A) over a combined or
  generic-query endpoint.
- **Promote-only** for now — no deprecate-from-UI (the service method exists;
  trivial to add later).

## Architecture

### 1. content-memory package (`@anubis/content-memory`)

- `ExperienceMemoriesRepo.listForWorkspace(workspaceId, { statuses?, limit? })`
  — **new**. `WHERE (workspace_id = ? OR workspace_id IS NULL)`, optional
  `status IN (...)`, `ORDER BY created_at DESC`, optional limit. Mirrors
  `recallActive`'s row mapping but without the active-only / platform
  constraints.
- `ExperienceIndexService.list(input)` — thin delegate to the new repo method.
- `AgentRunService.listForWorkspace(workspaceId, limit?)` — thin delegate to
  the **already-existing** `AgentRunsRepo.listForWorkspace`.

### 2. Backend routes (`packages/backend/src/content-memory.ts`)

- `GET /content-memory/memories?workspaceId=&status=&limit=` → `{ ok, items }`.
  Zod-validated query; `status` optional (omit ⇒ all four statuses);
  `workspaceId` required.
- `GET /content-memory/runs?workspaceId=&limit=` → `{ ok, items }`.
- Promote reuses the existing `POST /content-memory/memories/:id/promote`.

Errors normalize through `app.ts` (`ZodError` → 400).

### 3. Shared types (`packages/shared/src/index.ts`)

- `ExperienceMemorySummary`, `AgentRunSummary`, plus
  `ExperienceMemoryListResponse` / `AgentRunListResponse`. One contract shared
  by backend + frontend, matching the existing `*ListResponse` pattern.

### 4. Frontend (`@anubis/frontend`)

- `pages/memory.tsx` — reads `useActiveWorkspace()`, renders shadcn `Tabs`:
  - **Memories tab:** list of experience memories with a status filter
    (candidate / active / reinforced / deprecated), severity + scope badges,
    and a **Promote** button on candidates (calls promote → refetch). Empty
    state when none.
  - **Run Log tab:** reverse-chron `agent_runs` — timestamp, taskType,
    agentId, intent, validation-status badge, platform. Row expands to show
    userInput/output, retrieved-id counts, and error summary.
- `api.ts` — add `listExperienceMemories()`, `listAgentRuns()`,
  `promoteMemory()`.
- Nav wiring:
  - add `{ page: 'memory' }` to `Route` / `PageKey` in `lib/navigation.tsx`.
  - add a nav item to `components/dashboard/data.ts` (e.g. `BrainIcon`,
    label "Memory").
  - register the page in `components/dashboard/index.tsx`.

## Data flow

active workspace (`useActiveWorkspace`) → `activeWorkspaceId` →
`GET /content-memory/memories|runs?workspaceId=...` →
`getStack().experience.list(...)` / `getStack().agentRuns.listForWorkspace(...)`
→ repo SQL → shared summaries → rendered tabs. Promote: button →
`POST .../memories/:id/promote` → refetch memories.

## Error handling

- Missing/invalid `workspaceId` or bad `status` ⇒ Zod 400 with issues.
- Frontend surfaces fetch failures via the existing `api()` error path
  (thrown `Error` with readable detail); empty arrays render empty states.

## Testing

- content-memory unit tests: new `ExperienceMemoriesRepo.listForWorkspace`
  (status filter, global inclusion, ordering, limit) and
  `AgentRunService.listForWorkspace`.
- backend route tests: both GETs (workspace scoping, validation → 400).
- Frontend: light render test for the page (tab switch, promote calls API).

## Out of scope (YAGNI)

- Deprecate-from-UI.
- Pagination beyond a `limit`.
- Run-log search / advanced filtering.
- Real-time / streaming updates.
