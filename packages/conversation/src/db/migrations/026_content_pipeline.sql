CREATE TABLE content_pipeline (
  content_id            TEXT PRIMARY KEY,
  raw_idea              TEXT,
  improved_brief        TEXT,
  refined_content       TEXT,
  ai_review             TEXT,
  human_review          TEXT,
  transcript            TEXT,
  transcript_source     TEXT,
  auto_iteration_count  INTEGER NOT NULL DEFAULT 0,
  updated_at            INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE content_lessons (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL DEFAULT 'default',
  content_id          TEXT NOT NULL,
  source              TEXT NOT NULL CHECK (source IN ('ai_review','human_review','generation_failure','final_draft_review')),
  type                TEXT NOT NULL CHECK (type IN ('brand_alignment','tone_of_voice','niche_alignment','content_quality','visual_quality','copywriting_quality','technical_generation_error')),
  reason              TEXT NOT NULL,
  what_went_wrong     TEXT NOT NULL,
  how_to_improve      TEXT NOT NULL,
  related_brand_rule  TEXT,
  related_tone_rule   TEXT,
  related_niche_rule  TEXT,
  created_at          INTEGER NOT NULL
);

CREATE INDEX idx_content_lessons_project ON content_lessons(project_id, created_at DESC);
CREATE INDEX idx_content_lessons_content ON content_lessons(content_id, created_at DESC);
