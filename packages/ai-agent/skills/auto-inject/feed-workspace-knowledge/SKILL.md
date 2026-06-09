---
name: feed-workspace-knowledge
description: Feed and organize the knowledge base of the current workspace by checking and running Phase 1 (Foundation) and Phase 2 (Context).
when_to_use: When you need to fill, update, inspect, or structure the workspace knowledge base documents, business profiles, brand guidelines, or context documents.
---

# Feed Workspace Knowledge

Goal: fill current workspace knowledge base.

Workspace root is current folder.

Do not create nested workspace folder.

Use this structure:

```txt
_workspace.md
knowledge/
inbox/
outputs/
runtime/
datasets/
```

Only write trusted docs to:

```txt
_workspace.md
knowledge/
```

Do not write KB docs to:

```txt
inbox/
outputs/
runtime/
datasets/
```

Rules:

* markdown only
* kebab-case filenames
* no fake facts
* unknown = `TBD`
* preserve existing useful data
* do not blindly overwrite
* short, clear, index-friendly docs

Flow:

```txt
1. Read workspace.
2. Check existing knowledge.
3. Run Phase 1.
4. If Phase 1 enough, run Phase 2.
5. Report created, updated, skipped, missing.
```

Phase files:

```txt
phase-1-foundation.md
phase-2-context.md
```

Run Phase 1 first.

Run Phase 2 only after foundation exists.
