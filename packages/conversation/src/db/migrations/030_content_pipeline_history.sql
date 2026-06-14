-- Append-only history of each pipeline step's output, per iteration.
-- content_pipeline keeps only the latest value per step; this table preserves
-- every prior attempt so the full creation history is accessible at runtime.
CREATE TABLE content_pipeline_history (
  id          TEXT PRIMARY KEY,
  content_id  TEXT NOT NULL,
  iteration   INTEGER NOT NULL DEFAULT 0,
  step        TEXT NOT NULL CHECK (step IN ('extract','breakdown','refine','ai_review','human_review')),
  data        TEXT NOT NULL,
  profile_id  TEXT,
  agent       TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_content_pipeline_history_content ON content_pipeline_history(content_id, created_at);
