# Context

## Glossary

### Content Item

A piece of content the user plans, drafts, publishes, and tracks as their own work.

### Captured Post

A competitor or reference post captured from an external platform. Captured Posts can inspire one or more Content Items, but they are not the user's own planned content.

### Content Item Status

The lifecycle state of a Content Item. The canonical flow is idea -> brief -> draft -> review -> scheduled -> published, with rejected available for content that does not pass review. Rejected is not terminal: a rejected Content Item can return to draft after revision.

### Raw Brief

The captured analysis or planning brief that explains the reasoning behind a Content Item. It is stored as a snapshot on the Content Item.

### Improved Draft

The current candidate content produced from the Raw Brief and references. It is stored as a snapshot on the Content Item.

### Content Reference

The single Captured Post that a Content Item is based on. Each Content Item has exactly one Content Reference.

### Reference Effectiveness

How strongly the Content Reference performed as competitor content. It explains why the reference was selected.

### Content Effectiveness

How strongly a published Content Item performed as the user's own content. It is evaluated separately from Reference Effectiveness.

### Content Analytics

The performance measurements tracked for a published Content Item. For v1, the user provides the publishedUrl, and Anubis syncs available public engagement metrics such as likes and comments from that URL. Saves is part of the model but is not automatically populated yet. Broader insight metrics such as impressions, reach, shares, follows, and profileVisits are outside the v1 Content Planner scope.

### Content Planner

The workspace for the user's own Content Items. Content Planner is separate from the Content page, which remains the library of Captured Posts.

### Content Planner v1

The first Content Planner version supports creating a Content Item from a selected Content Reference, editing title, Raw Brief, Improved Draft, status, and publishedUrl, moving status forward or backward including rejected -> draft, syncing available published metrics from publishedUrl, and comparing Reference Effectiveness against Content Effectiveness. Content Planner v1 does not include a calendar.

### Project Scope

Content Items, Content Planner views, and Tasks are scoped to a Project. A Content Item belongs to exactly one Project, and its Content Reference should come from the same Project.

### Task

A generic project-scoped work item for coordinating execution. A Task can be assigned to an AI Agent Profile, linked to files, and linked to workflows.

### Task Assignee

The AI Agent Profile responsible for a Task. Task assignment uses an existing Profile, because a Profile defines the agent kind, configuration, credentials, and isolated agent home used for execution.

### Task Execution

The act of telling an AI Agent Profile to work on a Task. Task Execution is not automatic in v1; assigning a Task to a Profile means ownership only. Future execution behavior is initiated explicitly by a Manager.

### Manager

A future coordinating role that tracks Tasks, decides which Task should be executed, builds context for the executor, and validates the result. Manager behavior is outside the v1 Task Management scope.

### Task Management v1

The first Task Management version supports title, description, status, priority, projectId, assigneeProfileId, fileReferences, workflowReferences, createdAt, and updatedAt. Task Management v1 does not include automatic Task Execution or Manager behavior.

### Task Priority

The relative importance of a Task. Task Priority values are low, medium, high, and urgent.

### Task File Reference

An absolute or project-relative file path attached to a Task as context through the file explorer. A Task File Reference points at the real workspace file; Anubis does not copy the file contents into the Task.

### Task Workflow Reference

An existing Workflow linked to a Task as context. A Task Workflow Reference is informational only; it does not run, own, duplicate, or change workflow logic.

### Task Status

The lifecycle state of a Task. The canonical flow is backlog -> todo -> in progress -> in review -> done.

### Knowledge Base

The user's per-Project searchable corpus of indexed documents and chunks, backed by the external `anubis-engine` CLI binary that Anubis-desktop operates but does not implement. A Knowledge Base is scoped to exactly one Project; each Project has at most one Knowledge Base. Knowledge Base replaces the earlier "content-memory" and "similarity index" concepts; those terms are retired.

### Knowledge Base Workdir

The Project's `workspacePath` itself — Anubis passes it to the engine as `-w <workspacePath>` so the engine treats the whole project folder as the corpus to index. No subfolder is reserved; ignore patterns live in a `.anubisignore` file at the workspace root.

### Extractor

The external `anubis-extractor` CLI binary that Anubis-desktop operates to perform OCR on images and transcription on audio/video files. Anubis-desktop does not implement extraction itself; it spawns the binary and consumes its JSON output.
