-- Per-project Content Studio pipeline settings: prompt template + agent-behaviour
-- overrides per step (brief / refine / ai_review), stored as a JSON blob.
CREATE TABLE content_pipeline_settings (
  project_id  TEXT PRIMARY KEY,
  steps       TEXT NOT NULL DEFAULT '{}',
  updated_at  INTEGER NOT NULL DEFAULT 0
);
