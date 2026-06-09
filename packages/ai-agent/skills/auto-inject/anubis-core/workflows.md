# Workflows + cron jobs

Workflows have two graphs: `draftGraph` (editor) and `publishedGraph` (runs). Runs always use `publishedGraph`. If `draftAhead`, tell user before running.

Armed workflows fire on `scheduleTrigger` / `fileWatchTrigger` nodes in the published graph. Arming with no triggers → 400.

Workflow routes return **bare objects**, not the `{ ok: true, ... }` envelope. Errors return `{ error, message? }`.

Cron jobs are spawned by agents (not by you). PATCH/DELETE only.

## Routes — workflows

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/workflows` | Create |
| POST | `/workflows/import` | Import portable JSON |
| GET | `/workflows?projectId=` | List |
| GET | `/workflows/:id` | Get |
| GET | `/workflows/:id/export` | Export portable JSON |
| PATCH | `/workflows/:id` | Edit name/description |
| PUT | `/workflows/:id/draft` | Replace draft graph |
| POST | `/workflows/:id/publish` | Promote draft → published |
| POST | `/workflows/:id/arm` | Arm triggers |
| POST | `/workflows/:id/disarm` | Disarm |
| DELETE | `/workflows/:id` | Delete |
| POST | `/workflows/:id/runs` | Start run |
| GET | `/workflows/:id/runs` | List runs |
| GET | `/workflows/:id/active-run` | `{ runId: null \| id }` |
| GET | `/workflows/runs/:runId` | `{ run, steps }` |
| GET | `/workflows/runs/:runId/events` | SSE |
| POST | `/workflows/runs/:runId/decisions` | Approve/reject paused node |
| DELETE | `/workflows/runs/:runId` | Cancel if active, delete if finished |
| GET | `/workflows/artifacts?path=` | Serve file under `<dataDir>/workflow-runs/` |

## Routes — cron jobs

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/cron-jobs?conversationId=` | List |
| PATCH | `/cron-jobs/:id` | Edit |
| DELETE | `/cron-jobs/:id` | Delete |

No POST. To create a cron, ask the agent inside a conversation.

## POST /workflows

```ts
{ name: string, projectId?, description? }
```

## POST /workflows/import

```ts
{
  anubisWorkflowExport?: 1
  name?, projectId?, description?: string|null
  graph: WorkflowGraph                 // validated
}
```

## GET /workflows list response

```ts
{ items: Array<{
  id, name, description,
  hasPublished: boolean,
  draftAhead: boolean,                 // ← check before running
  draftUpdatedAt, publishedAt,
  lastRun?: { id, status, startedAt },
  previewGraph: string,
  hasTrigger: boolean,
  armed: boolean
}>}
```

## PUT /workflows/:id/draft

```ts
{ draftGraph: string }                 // serialised WorkflowGraph JSON
```

Bad shape → `400 invalid_graph`.

## POST /workflows/:id/runs

```ts
{ nodeDataOverrides?: Record<string, unknown> }  // empty {} OK
```

Response: `{ runId }` (201).

Errors:
- `400 invalid_graph` — published graph stale; re-publish.
- `409 already_running` — cancel the active run first (or `DELETE /workflows/runs/<existing>`).
- `400 bad_request` — surface `message`.

Always check `GET /workflows/:id/active-run` before launching.

## SSE events

```bash
curl --no-buffer "$BASE/workflows/runs/$RUN/events"
```

Replays buffered events on connect, then streams live. If run already finished → replay + close.

## Decisions (paused human-approval nodes)

```bash
curl -s -X POST "$BASE/workflows/runs/$RUN/decisions" -H 'Content-Type: application/json' \
  -d '{"nodeId":"<from event>","decision":"approved","notes":"ok"}'
```

`decision`: `approved` | `rejected`. `404 no_pending_decision` if no node is waiting.

## DELETE /workflows/runs/:runId

Active → cancels. Finished → deletes history row. Confirm with user before firing on a finished run.

## GET /workflows/artifacts?path=

Absolute path under `<dataDir>/workflow-runs/` only. Else `403 forbidden`. Missing → `404 not_found`.

## PATCH /cron-jobs/:id

```ts
{ name?, schedule?: string, scheduleDescription?, prompt?, enabled?: boolean }
```

## Example

```bash
WF=$(curl -s "$BASE/workflows?projectId=$PID" | jq -r '.items[0].id')
curl -s "$BASE/workflows/$WF/active-run"
RUN=$(curl -s -X POST "$BASE/workflows/$WF/runs" -H 'Content-Type: application/json' -d '{}' | jq -r .runId)
curl --no-buffer "$BASE/workflows/runs/$RUN/events"
```

If `draftAhead: true`, run `POST /workflows/$WF/publish` first. Re-arm if previously armed.
