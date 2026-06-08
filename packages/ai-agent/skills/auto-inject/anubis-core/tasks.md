# Tasks

Generic to-dos scoped to a project. Use this file when the user is managing **work**, not content drafts (those live in `content.md`).

## When to use this file

- "Add a task: redesign the brief template."
- "What's in my backlog for *Space*?"
- "Move task X to in-review."
- "Assign this to my Codex profile."
- "Link this task to the *daily-sync* workflow."
- "I'm done — mark it `done`."

## Mental model

A task belongs to a project (`default` if omitted). Each task has:

- `title` (required), optional `description`.
- `status` — `backlog | todo | in_progress | in_review | done`.
- `priority` — `low | medium | high | urgent`.
- `assigneeProfileId` — optional, must be an existing profile id (see `admin.md` → profiles).
- `fileReferences[]` — opaque strings the UI uses to link files. Treat as a free-form list of paths/ids; max 100 entries.
- `workflowReferences[]` — workflow ids. The backend **validates** that each id exists and belongs to the same project as the task. Max 100.

Tasks are independent of content items — they're for any work the user wants tracked (template fixes, follow-ups, infra tweaks, etc.).

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/tasks?projectId&status&assigneeProfileId&limit` | List, filtered |
| GET | `/tasks/:id` | Get one (404 if missing) |
| POST | `/tasks` | Create |
| PATCH | `/tasks/:id` | Update |
| DELETE | `/tasks/:id` | Soft-delete |

All bodies `.strict()` — unknown keys → 400.

## POST `/tasks`

```ts
{
  projectId?: string                                    // omitted → 'default'
  title: string                                         // required, trimmed
  description?: string                                  // empty/whitespace → dropped
  status?: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done'
  priority?: 'low' | 'medium' | 'high' | 'urgent'
  assigneeProfileId?: string                            // must exist
  fileReferences?: string[]                             // max 100
  workflowReferences?: string[]                         // max 100, must exist & match project
}
```

```bash
curl -s -X POST "$BASE/tasks" \
  -H 'Content-Type: application/json' \
  -d '{
    "projectId":"'$PID'",
    "title":"Redesign content brief template",
    "priority":"high",
    "workflowReferences":["'$WF_ID'"]
  }'
```

Response: `{ ok: true, task }` (201).

Validation 404s you may hit:

- `project_not_found` — bad `projectId`.
- `assignee_profile_not_found` — bad `assigneeProfileId`.
- `workflow_not_found` — one of `workflowReferences` doesn't exist.
- `workflow_project_mismatch` (400) — workflow belongs to a different project.

## GET `/tasks`

```ts
?projectId=<id>&status=<status>&assigneeProfileId=<id>&limit=<int 1..500, default 200>
```

Returns flat `TaskSummary` items (id, title, description, status, priority, assignee, references, timestamps). No project/profile/workflow joining — call those endpoints separately if the user wants names instead of ids.

## PATCH `/tasks/:id`

```ts
{
  title?: string
  description?: string | null                           // null → clear
  status?: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done'
  priority?: 'low' | 'medium' | 'high' | 'urgent'
  assigneeProfileId?: string | null                     // null → unassign
  fileReferences?: string[]                             // replaces the list (deduped + trimmed)
  workflowReferences?: string[]                         // replaces the list, re-validated
}
```

`fileReferences` and `workflowReferences` **replace** the existing arrays — pass the full intended list, not a delta. Empty array is allowed and clears the list. Each replacement re-runs the validation rules from POST.

```bash
# Bump to in_progress and reassign
curl -s -X PATCH "$BASE/tasks/$TID" \
  -H 'Content-Type: application/json' \
  -d '{"status":"in_progress","assigneeProfileId":"'$PROFILE_ID'"}'

# Add a workflow link — must include any existing links you want to keep
curl -s -X PATCH "$BASE/tasks/$TID" \
  -H 'Content-Type: application/json' \
  -d '{"workflowReferences":["'$WF1'","'$WF2'"]}'
```

## DELETE `/tasks/:id`

Soft-delete. 404 if id unknown.

## Workflows the user actually asks for

### "What am I working on for *Space*?"

```bash
curl -s "$BASE/tasks?projectId=$PID&status=in_progress"
curl -s "$BASE/tasks?projectId=$PID&status=todo"
```

Show counts + titles per status. Don't dump full JSON.

### "Move this to review"

If you don't already know the id, list first and disambiguate by title rather than guessing. Patch with `{ "status": "in_review" }`.

### "Assign this to whoever owns the codex profile"

1. `GET /profiles` (see `admin.md`) to find the profile id by name/agent.
2. `PATCH /tasks/:id` with `{ "assigneeProfileId": "..." }`.

### "Unassign / clear the description"

PATCH with `null`:

```bash
curl -s -X PATCH "$BASE/tasks/$TID" \
  -H 'Content-Type: application/json' \
  -d '{"assigneeProfileId":null,"description":null}'
```
