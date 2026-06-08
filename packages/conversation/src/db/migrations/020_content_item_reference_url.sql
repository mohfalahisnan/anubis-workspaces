CREATE TABLE content_items_next (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id),
  reference_post_id     TEXT REFERENCES captured_posts(id) ON DELETE RESTRICT,
  reference_url         TEXT,
  title                 TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('idea', 'brief', 'draft', 'review', 'scheduled', 'published', 'rejected')),
  raw_brief             TEXT,
  improved_draft        TEXT,
  rejection_reason      TEXT,
  published_url         TEXT,
  published_at          TEXT,
  analytics_likes       INTEGER,
  analytics_comments    INTEGER,
  analytics_saves       INTEGER,
  metrics_synced_at     INTEGER,
  source_workflow_run_id TEXT,
  source_conversation_id TEXT,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  deleted_at            INTEGER,
  CHECK (reference_post_id IS NOT NULL OR reference_url IS NOT NULL)
);

INSERT INTO content_items_next (
  id, project_id, reference_post_id, reference_url, title, status, raw_brief, improved_draft,
  rejection_reason, published_url, published_at, analytics_likes, analytics_comments, analytics_saves,
  metrics_synced_at, source_workflow_run_id, source_conversation_id, created_at, updated_at, deleted_at
)
SELECT
  id, project_id, reference_post_id, NULL, title, status, raw_brief, improved_draft,
  rejection_reason, published_url, published_at, analytics_likes, analytics_comments, analytics_saves,
  metrics_synced_at, source_workflow_run_id, source_conversation_id, created_at, updated_at, deleted_at
FROM content_items;

DROP TABLE content_items;
ALTER TABLE content_items_next RENAME TO content_items;

CREATE INDEX idx_content_items_project_status
  ON content_items(project_id, status, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_content_items_reference
  ON content_items(reference_post_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_content_items_reference_url
  ON content_items(reference_url)
  WHERE deleted_at IS NULL;
