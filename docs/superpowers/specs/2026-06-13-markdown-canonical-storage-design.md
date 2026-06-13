# Markdown-Canonical Project Storage

**Status:** Approved for implementation
**Issue:** #39
**Scope:** Tasks, competitors, authored content, and curated research

## Problem

Anubis serves both humans and AI agents, but durable project content currently lives behind SQLite repositories and application UI. That makes ordinary inspection, editing, version control, and Knowledge Base indexing harder than necessary.

The Project workspace should be the product's durable, readable source of truth. SQLite should remain focused on conversations and execution state that benefits from transactional or high-volume storage.

## Decision

Markdown files inside each Project workspace are canonical for:

- tasks;
- competitor profiles;
- authored content briefs and drafts;
- curated research documents.

Repositories scan and parse files on every request. There is no watcher, long-lived cache, SQLite document projection, migration of existing development data, or automatic Knowledge Base reindex.

SQLite remains canonical for:

- Projects and their workspace paths;
- conversations, messages, artifacts, profiles, and agent sessions;
- cron jobs and workflow definitions/runs;
- captured posts and raw crawler payloads;
- research sessions, candidates, scoring, and decisions;
- competitor capture counters and baselines;
- content analytics snapshots;
- caches and indexes.

## Workspace Layout

```text
<project-workspace>/
  _workspace.md
  tasks/
    backlog/
    todo/
    in-progress/
    in-review/
    done/
  knowledge/
    competitors/
    content/
    research/
```

Every Project receives a deterministic workspace. A Project without an explicit `workdir` uses the application-managed `workspaces/<project-id>` directory and persists that path on the Project record.

## Common Document Contract

Every canonical document contains YAML frontmatter with:

```yaml
schema_version: 1
id: stable-id
type: task | competitor | content | research
project_id: project-id
created_at: 2026-06-13T00:00:00.000Z
updated_at: 2026-06-13T00:00:00.000Z
```

IDs define identity. Filenames and paths are presentation details and may change without breaking references. Application-generated filenames use a readable slug plus a short ID suffix.

All writes use a temporary sibling file followed by rename. Writes preserve unknown frontmatter keys. Invalid YAML, schema violations, type mismatches, and duplicate IDs raise actionable document-storage errors rather than disappearing silently.

## Task Documents

Task metadata lives in frontmatter:

```yaml
title: Build task board
status: in_progress
priority: high
assignee_profile_id: codex-coding
file_references: []
workflow_references: []
```

The Markdown body is the task description. The status directory mirrors frontmatter using kebab-case directory names. Application status updates move the file. A manually introduced directory/frontmatter mismatch is reported as invalid.

## Competitor Documents

Competitor metadata lives in frontmatter:

```yaml
handle: "@creator"
display_name: Creator
niche: Education
tint: "#B5663F"
followers: 100000
avg_likes: 5000
level: green
platform: instagram
status: active
favorite: false
```

The body uses `## Bio` and `## Notes` sections. Capture-derived `postCount`, `lastRefreshedAt`, and baseline fields remain operational SQLite values and are merged into returned domain objects.

SQLite retains a minimal competitor anchor row because captured posts and research candidates reference competitor IDs. Authored fields are never read from that row.

## Content Documents

Content metadata lives in frontmatter:

```yaml
title: My content idea
status: draft
reference_post_id: post-id
reference_url: null
rejection_reason: null
published_url: null
published_at: null
source_workflow_run_id: null
source_conversation_id: null
```

The body uses `## Brief` and `## Draft` sections. Analytics and metric synchronization timestamps remain in an operational SQLite table keyed by content ID.

## Curated Research Documents

Curated research is distinct from operational research sessions and candidates. Its metadata includes title, status, tags, and stable evidence references. Its body uses `## Summary`, `## Findings`, and `## Evidence` sections.

The backend exposes CRUD endpoints for curated research documents under `/research/documents`. Promotion from an operational candidate creates a curated research document with candidate, competitor, post, and source URL references.

## Read and Write Semantics

- List and lookup operations scan current files on each call.
- Manual edits are visible on the next API request.
- Knowledge Base indexing remains explicit.
- Delete removes the canonical file; operational records may remain for historical execution integrity.
- Unknown frontmatter fields survive application updates.
- Unknown Markdown sections survive content and competitor updates.
- Paths are resolved beneath the Project workspace and checked against traversal and symlink escape.

## Compatibility

Existing task, competitor, and content HTTP success payloads remain compatible. Existing frontend screens may continue using those APIs. Curated research adds new shared types and routes without changing operational research endpoints.

## Non-Goals

- automatic filesystem watching or reindexing;
- preserving current development data;
- moving workflows, conversations, captures, candidates, or analytics into Markdown;
- Git synchronization or merge conflict handling;
- a general user-defined document framework;
- performance indexing before direct scanning is measured as insufficient.
