CREATE TABLE agent_runs (
  id                              TEXT PRIMARY KEY,
  workspace_id                    TEXT NOT NULL REFERENCES brand_workspaces(id),
  platform                        TEXT,
  campaign_id                     TEXT,
  agent_id                        TEXT NOT NULL,
  workflow_id                     TEXT,
  task_type                       TEXT NOT NULL,
  user_input                      TEXT NOT NULL,
  intent                          TEXT NOT NULL,
  retrieved_chunk_ids             TEXT NOT NULL DEFAULT '[]',
  retrieved_decision_ids          TEXT NOT NULL DEFAULT '[]',
  retrieved_experience_memory_ids TEXT NOT NULL DEFAULT '[]',
  retrieved_similarity_item_ids   TEXT NOT NULL DEFAULT '[]',
  context_pack_id                 TEXT,
  plan                            TEXT,
  output                          TEXT NOT NULL,
  validation_status               TEXT NOT NULL CHECK (validation_status IN ('passed','failed','needs_review')),
  human_feedback                  TEXT,
  error_type                      TEXT,
  error_summary                   TEXT,
  created_at                      INTEGER NOT NULL
);
CREATE INDEX idx_agent_runs_workspace ON agent_runs(workspace_id, created_at DESC);
