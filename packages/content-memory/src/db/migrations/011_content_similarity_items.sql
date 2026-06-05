-- Workspace-scoped similarity store. Embeddings inline as BLOB; cosine ranking in JS.
CREATE TABLE content_similarity_items (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL REFERENCES brand_workspaces(id),
  platform           TEXT NOT NULL,
  content_id         TEXT,                          -- e.g. captured_posts.id (no FK: items outlive posts)
  content_type       TEXT NOT NULL CHECK (content_type IN
                       ('competitor_post', 'own_post', 'approved_post', 'rejected_post', 'generated_draft')),
  caption            TEXT,
  transcript         TEXT,
  ocr_text           TEXT,
  visual_description TEXT,
  normalized_text    TEXT NOT NULL,
  embedding          BLOB NOT NULL,
  performance_score  REAL,
  engagement_score   REAL,
  brand_fit_score    REAL,
  approval_status    TEXT CHECK (approval_status IS NULL OR approval_status IN
                       ('approved', 'rejected', 'needs_review')),
  rejection_reason   TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE INDEX idx_similarity_workspace_platform
  ON content_similarity_items(workspace_id, platform);

-- Upsert key: one row per (workspace, source content). NULL content_id never conflicts.
CREATE UNIQUE INDEX uq_similarity_content
  ON content_similarity_items(workspace_id, content_id)
  WHERE content_id IS NOT NULL;
