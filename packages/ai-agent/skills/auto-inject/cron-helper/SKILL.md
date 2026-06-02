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
