# Workflows + cron jobs

Workflows are node-graphs the user builds in the visual workflow editor — chains of crawler calls, AI agent calls, decisions, etc. Cron jobs are recurring agent prompts spawned by the conversation runtime. This file is for *operating* both.

## When to use this file

- "Run the *daily-sync* workflow now."
- "Why didn't the workflow fire this morning?" → check `armed` state + trigger configuration.
- "Arm / disarm the schedule on this workflow."
- "Watch the workflow run live."
- "I drafted changes — publish them."
- "Approve this pending decision."
- "Cancel the running workflow."
- "Export this workflow so I can share it" / "Import this workflow file."
- "List my cron jobs" / "Disable this cron job."

## Mental model

A **workflow** has two graphs:

- `draftGraph` — what the user is editing. Updated by the editor.
- `publishedGraph` — what actually runs. Promoted from draft via `POST /:id/publish`.

A run *always* uses the published graph; you cannot run a draft. When the user says "run it", check `hasPublished` and `draftAhead` on the list response — if `draftAhead` is true, warn them their draft changes won't take effect until they publish.

**Triggers** — if the published graph contains a `scheduleTrigger` or `fileWatchTrigger` node, you can `arm` the workflow. Armed workflows run themselves automatically; `armed: false` means the user has to start runs manually. Arming a workflow with no triggers in the published graph → 400.

**Decisions** — graphs can pause on human-approval nodes. The run sits waiting on `?` until you POST to `/runs/:runId/decisions` with `approved` or `rejected`.

**Events** — runs emit SSE events. Connect to `/runs/:runId/events` to follow progress. The route replays buffered events on connect so a fresh subscriber catches up, then streams live ones; if the run finished before you subscribed, it streams the buffered events and closes immediately.

**Artifacts** — runs write files under `<dataDir>/workflow-runs/`. Fetch any of them via `GET /workflows/artifacts?path=<absolute path>` — the route refuses anything outside that directory.

**Cron jobs** are *not* created by you. The conversation/agent runtime spawns them when an agent run sets up a schedule. You only list, edit, and delete them.

## Endpoints

### Workflow CRUD + lifecycle

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/workflows` | Create a blank workflow |
| POST | `/workflows/import` | Import a workflow export envelope |
| GET | `/workflows?projectId=` | List, project-scoped if provided |
| GET | `/workflows/:id` | Get one (404 if missing) |
| GET | `/workflows/:id/export` | Export as portable JSON |
| PATCH | `/workflows/:id` | Edit name/description |
| PUT | `/workflows/:id/draft` | Replace the draft graph |
| POST | `/workflows/:id/publish` | Promote draft → published |
| POST | `/workflows/:id/arm` | Arm scheduled/file-watch triggers |
| POST | `/workflows/:id/disarm` | Disarm |
| DELETE | `/workflows/:id` | Delete |

### Runs + events

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/workflows/:id/runs` | Start a run from the published graph |
| GET | `/workflows/:id/runs` | List runs for this workflow |
| GET | `/workflows/:id/active-run` | `{ runId: null \| id }` |
| GET | `/workflows/runs/:runId` | `{ run, steps }` |
| DELETE | `/workflows/runs/:runId` | Cancel if active, delete if finished |
| GET | `/workflows/runs/:runId/events` | SSE stream |
| POST | `/workflows/runs/:runId/decisions` | Approve/reject a paused decision node |
| GET | `/workflows/artifacts?path=` | Serve an artifact file |

### Cron jobs

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/cron-jobs?conversationId=` | List, optionally filtered |
| PATCH | `/cron-jobs/:id` | Edit name/schedule/prompt/enabled |
| DELETE | `/cron-jobs/:id` | Delete |

> Note: workflow routes return the **bare object** on success, not `{ ok: true, ... }`. Errors return `{ error: 'code', message? }` rather than the standard envelope. Cron-job routes follow the standard envelope.

## POST `/workflows`

```ts
{
  name: string                  // required
  projectId?: string            // omitted → 'default'
  description?: string
}
```

Returns the created workflow (201).

## POST `/workflows/import`

```ts
{
  anubisWorkflowExport?: 1      // version literal; current export sets 1
  name?: string
  projectId?: string
  description?: string | null
  graph: <WorkflowGraph>        // validated against WorkflowGraphSchema
}
```

The body usually comes from a `GET /workflows/:id/export` response on another machine.

## GET `/workflows`

Optional `?projectId=`. Response:

```ts
{
  items: Array<{
    id, name, description,
    hasPublished: boolean,
    draftAhead: boolean,          // draft differs from published
    draftUpdatedAt, publishedAt,
    lastRun?: { id, status, startedAt },
    previewGraph: string,         // serialised draft JSON
    hasTrigger: boolean,          // published graph has a trigger node
    armed: boolean
  }>
}
```

Use this list to ground every other workflow operation — never invent ids.

## GET `/workflows/:id` and export

`GET /workflows/:id` returns the full workflow plus `hasTrigger` + `armed`. `GET /workflows/:id/export` returns the portable envelope (`anubisWorkflowExport: 1, exportedAt, name, description, graph: <parsed>`) suitable for `/workflows/import`.

## PUT `/workflows/:id/draft`

```ts
{ draftGraph: string }   // serialised JSON of a WorkflowGraph
```

The route parses and validates the graph against `WorkflowGraphSchema` before writing. Bad shape → 400 `invalid_graph`.

## POST `/workflows/:id/publish`

No body. Promotes `draftGraph` to `publishedGraph` and stamps `publishedAt`. After publishing, you may need to re-arm (the trigger manager re-evaluates the published graph; arming/disarming is explicit).

## POST `/workflows/:id/arm` and `/disarm`

Arm wires up trigger handlers (schedule / file-watch) based on the *published* graph. Returns `{ armed: true }`. If the published graph has no triggers → `400 { error: 'bad_request', message }`. Disarm always returns `{ armed: false }`.

## POST `/workflows/:id/runs`

Body (optional, empty `{}` allowed):

```ts
{
  nodeDataOverrides?: Record<string, unknown>     // keyed by node id; merged into that node's data for this run only
}
```

Response: `{ runId }` (201).

Failure responses:

- `400 invalid_graph` — published graph fails validation (likely stale; user should re-publish).
- `409 already_running` — there's an active run for this workflow; either wait for it or `DELETE /workflows/runs/<existing>` to cancel.
- `400 bad_request` — other validation issues; surface `message`.

Use `GET /workflows/:id/active-run` to check for an active run before launching.

## GET `/workflows/runs/:runId`

Returns `{ run, steps }` — the run summary plus per-node execution steps. Poll this for snapshot views; stream events for live.

## GET `/workflows/runs/:runId/events` (SSE)

```bash
curl --no-buffer "$BASE/workflows/runs/$RUN_ID/events"
```

Each event is `data: <json>\n\n`. The server replays buffered events (since run start) on connect, then streams live ones. If the run already finished, you receive the replay and the stream closes immediately.

When events show a pending human-approval node, post to `/runs/:runId/decisions`:

```bash
curl -s -X POST "$BASE/workflows/runs/$RUN_ID/decisions" \
  -H 'Content-Type: application/json' \
  -d '{"nodeId":"approve-1","decision":"approved","notes":"Looks good"}'
```

`decision` is `approved` or `rejected`. 404 `no_pending_decision` if there isn't one waiting.

## DELETE `/workflows/runs/:runId`

If the run is still active → cancels it (204). If it's already finished → deletes the historical run row (204).

## GET `/workflows/artifacts?path=`

```bash
curl -s -o screenshot.png "$BASE/workflows/artifacts?path=$ARTIFACT_PATH"
```

Path must be absolute and under `<dataDir>/workflow-runs/`. Anything else → `403 forbidden`. Missing file → `404 not_found`.

## Cron jobs

### GET `/cron-jobs`

Optional `?conversationId=<id>` filter. Returns the standard `{ ok: true, items }`.

### PATCH `/cron-jobs/:id`

```ts
{
  name?: string
  schedule?: string               // cron expression
  scheduleDescription?: string
  prompt?: string
  enabled?: boolean
}
```

### DELETE `/cron-jobs/:id`

There is **no `POST /cron-jobs`** — cron jobs are created by an agent run inside a conversation, not by the API. If the user asks to "create a cron job", they actually want either:

- A scheduled prompt in an existing conversation — direct them to ask the agent (or you, in-conversation) to "set a cron to <X> every <when>".
- A scheduled workflow run — that's `armed: true` on a workflow whose published graph contains a `scheduleTrigger` node.

## Workflows the user actually asks for

### Run a workflow and watch it

```bash
# 1. Find it
curl -s "$BASE/workflows?projectId=$PID"
# (user picks one; let's call its id $WF)

# 2. Make sure nothing else is running
curl -s "$BASE/workflows/$WF/active-run"

# 3. Start
RUN=$(curl -s -X POST "$BASE/workflows/$WF/runs" \
  -H 'Content-Type: application/json' \
  -d '{}' | jq -r .runId)

# 4. Stream events
curl --no-buffer "$BASE/workflows/runs/$RUN/events"
```

If `already_running` comes back on step 3, ask the user whether to cancel the existing run before starting a new one.

### Publish edits before running

If the list shows `draftAhead: true` and the user says "run it":

```bash
curl -s -X POST "$BASE/workflows/$WF/publish"
# Then proceed with /runs as above
```

If the workflow was previously armed and the published graph changed shape, re-arm:

```bash
curl -s -X POST "$BASE/workflows/$WF/arm"
```

### Approve a pending decision while streaming events

When the SSE stream emits an event indicating a node is waiting (`type` will reflect a decision node), post:

```bash
curl -s -X POST "$BASE/workflows/runs/$RUN/decisions" \
  -H 'Content-Type: application/json' \
  -d '{"nodeId":"<id from event>","decision":"approved"}'
```

The run resumes; events continue streaming.

### Cancel a stuck run

```bash
curl -s -X DELETE "$BASE/workflows/runs/$RUN"   # 204 either way
```

This cancels if active and deletes if finished — confirm with the user before firing on a finished run, since the historical row goes away too.

### Disable a noisy cron

```bash
curl -s "$BASE/cron-jobs"
curl -s -X PATCH "$BASE/cron-jobs/$JOB" \
  -H 'Content-Type: application/json' \
  -d '{"enabled":false}'
```
