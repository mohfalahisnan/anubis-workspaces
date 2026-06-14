CREATE TABLE content_generation_tasks (
  id            TEXT PRIMARY KEY,
  content_id    TEXT NOT NULL,
  project_id    TEXT NOT NULL DEFAULT 'default',
  type          TEXT NOT NULL,
  capability    TEXT NOT NULL,
  generator     TEXT NOT NULL DEFAULT '',
  input_prompt  TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled','manual')),
  output        TEXT,
  error         TEXT,
  retry_count   INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX idx_content_generation_tasks_content ON content_generation_tasks(content_id, created_at);

ALTER TABLE content_pipeline ADD COLUMN draft_output TEXT;
