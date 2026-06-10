---
name: cron-helper
description: Help the user create and manage scheduled jobs by emitting [CRON_*] command blocks.
when_to_use: User mentions schedules, cron, recurring jobs, or wants the agent to run at a later time.
---

# Cron Helper

You can register, update, list, and delete scheduled jobs that re-invoke this conversation later. Emit one of the command blocks below in your final response and the system will execute it:

```
[CRON_CREATE]
name: Friendly job name
schedule: 0 0 * * *
schedule_description: Every day at midnight
message: The prompt to re-send when the job fires
[/CRON_CREATE]
```

```
[CRON_LIST]
```

```
[CRON_DELETE: <job-id>]
```

```
[CRON_UPDATE: <job-id>]
name: New name (optional)
schedule: 0 12 * * * (optional)
schedule_description: Every day at noon (optional)
message: Replacement prompt (optional)
[/CRON_UPDATE]
```

Use a `schedule_description` in plain English so the user can confirm the cadence at a glance.

## Action types

If `action_type` is omitted, the job defaults to `message` and re-sends `message:` into the same conversation.

### `message`

```text
[CRON_CREATE]
name: Weekly check-in
schedule: 0 9 * * 1
schedule_description: Every Monday at 9am
message: Review the latest backlog, list blockers, and propose next actions.
[/CRON_CREATE]
```

### `competitor-discovery`

Use `config_json` on one line with this schema:

```json
{
  "projectId": "project-id",
  "query": "#hashtag | keyword phrase | explore",
  "captureProfile": "public | login",
  "defaultLevel": "black | green | yellow | red"
}
```

Example:

```text
[CRON_CREATE]
name: Discover space creators
schedule: 0 8 * * 1
schedule_description: Every Monday at 8am
action_type: competitor-discovery
config_json: {"projectId":"project-id","query":"#spacephotography","captureProfile":"login","defaultLevel":"green"}
[/CRON_CREATE]
```

### `capture-posts`

Use `config_json` on one line with this schema:

```json
{
  "projectId": "project-id",
  "handles": "all | [\"handle_one\",\"handle_two\"]",
  "captureProfile": "public | login",
  "postLimit": 12
}
```

Example:

```text
[CRON_CREATE]
name: Refresh priority competitors
schedule: 0 7 * * 1-5
schedule_description: Weekdays at 7am
action_type: capture-posts
config_json: {"projectId":"project-id","handles":["@nasa","@spacex"],"captureProfile":"public","postLimit":12}
[/CRON_CREATE]
```

### `workflow`

Schedules a saved workflow to run on the cron cadence. The job fires the workflow's **published** version through the same execution path used by the workflow's own arm/trigger mechanism (so concurrent fires are skipped while a run is active, and the run shows up under the workflow's run history). Run results and errors surface via a desktop notification plus a cron run-output sidecar under `<workspace>/.anubis/tmp/`.

Use `config_json` on one line with this schema:

```json
{
  "workflowId": "workflow-id",
  "workflowName": "Friendly workflow name",
  "projectId": "project-id",
  "input": { "node-id": { "field": "value" } }
}
```

- Provide **either** `workflowId` (preferred) **or** `workflowName`. When only a name is given, it is resolved within `projectId` scope (exact match first, then case-insensitive).
- `projectId` is optional; it scopes the name lookup and defaults to the job's project.
- `input` is optional. It is a JSON object of **per-node data overrides** applied to the published graph on run (same shape as a manual "run workflow" override payload), keyed by node id. Omit it for no overrides.

Example:

```text
[CRON_CREATE]
name: Nightly content pipeline
schedule: 0 2 * * *
schedule_description: Every day at 2am
action_type: workflow
config_json: {"workflowName":"Content pipeline","projectId":"project-id","input":{"prompt-node":{"value":"daily digest"}}}
[/CRON_CREATE]
```

`[CRON_UPDATE]` accepts the same optional `action_type:` and `config_json:` fields when changing an existing job.

> Re-emitting `[CRON_CREATE]` with the same `name:` and `schedule:` in the same conversation **updates** the existing job in place instead of creating a duplicate — safe to re-run a scheduling prompt.
