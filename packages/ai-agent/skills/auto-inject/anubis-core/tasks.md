# Tasks

Generic to-dos. Scoped to a project.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/tasks?projectId&status&assigneeProfileId&limit` | List |
| GET | `/tasks/:id` | Get |
| POST | `/tasks` | Create |
| PATCH | `/tasks/:id` | Update |
| DELETE | `/tasks/:id` | Soft-delete |

## POST /tasks

```ts
{
  projectId?: string                   // default 'default'
  title: string                        // required
  description?: string
  status?: 'backlog'|'todo'|'in_progress'|'in_review'|'done'
  priority?: 'low'|'medium'|'high'|'urgent'
  assigneeProfileId?: string           // must exist
  fileReferences?: string[]            // max 100
  workflowReferences?: string[]        // max 100, must exist + same project
}
```

Validation 4xx:
- `404 project_not_found`
- `404 assignee_profile_not_found`
- `404 workflow_not_found`
- `400 workflow_project_mismatch`

## PATCH /tasks/:id

```ts
{
  title?, description?: string|null, status?, priority?
  assigneeProfileId?: string|null      // null = unassign
  fileReferences?: string[]            // REPLACES the list
  workflowReferences?: string[]        // REPLACES, re-validated
}
```

Array fields replace, not delta. Pass `[]` to clear.

## Example

```bash
curl -s "$BASE/tasks?projectId=$PID&status=in_progress"
curl -s -X PATCH "$BASE/tasks/$TID" -H 'Content-Type: application/json' \
  -d '{"status":"in_review","assigneeProfileId":"'$PROFILE_ID'"}'
```
