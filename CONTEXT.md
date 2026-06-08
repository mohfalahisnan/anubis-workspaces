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

The performance measurements tracked for a published Content Item. For v1, the user provides the publishedUrl, and Anubis syncs available public engagement metrics such as likes and comments from that URL. Saves is part of the model but is not automatically populated yet. Broader insight metrics such as impressions, reach, shares, follows, and profileVisits are outside the v1 planner scope.

### Planner

The workspace for the user's own Content Items. Planner is separate from the Content page, which remains the library of Captured Posts.

### Planner v1

The first Planner version supports creating a Content Item from a selected Content Reference, editing title, Raw Brief, Improved Draft, status, and publishedUrl, moving status forward or backward including rejected -> draft, syncing available published metrics from publishedUrl, and comparing Reference Effectiveness against Content Effectiveness. Planner v1 does not include a calendar.

### Project Scope

Content Items and Planner views are scoped to a Project. A Content Item belongs to exactly one Project, and its Content Reference should come from the same Project.
