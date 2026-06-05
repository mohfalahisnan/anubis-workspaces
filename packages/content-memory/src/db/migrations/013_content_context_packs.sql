CREATE TABLE content_context_packs (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES brand_workspaces(id),
  platform     TEXT NOT NULL,
  campaign_id  TEXT,
  task_type    TEXT NOT NULL,
  objective    TEXT NOT NULL,
  query        TEXT NOT NULL,
  context_json TEXT NOT NULL,   -- serialized ContentContextPack
  token_count  INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_context_packs_workspace
  ON content_context_packs(workspace_id, created_at DESC);
