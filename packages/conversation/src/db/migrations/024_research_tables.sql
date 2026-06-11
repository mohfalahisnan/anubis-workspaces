CREATE TABLE research_sessions (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id),
  controls    TEXT NOT NULL,                       -- JSON ResearchControls
  status      TEXT NOT NULL,                       -- 'scoring'|'validating'|'done'|'error'
  counts      TEXT,                                -- JSON ResearchSessionCounts
  error       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

CREATE INDEX idx_research_sessions_project
  ON research_sessions(project_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE research_candidates (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id),
  session_id          TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
  competitor_id       TEXT NOT NULL REFERENCES competitors(id),
  post_id             TEXT NOT NULL REFERENCES captured_posts(id),
  platform            TEXT,
  post_url            TEXT,
  posted_at           TEXT,
  caption             TEXT,
  media_kind          TEXT,
  likes               INTEGER,
  baseline_likes      INTEGER,
  score               REAL,
  competitor_level    TEXT,
  candidate_level     TEXT,
  niche_aligned       INTEGER,                     -- 1|0|NULL(pending)
  niche_reason        TEXT,
  validation_status   TEXT NOT NULL,               -- 'valid'|'invalid'|'pending'
  validation_failures TEXT,                        -- JSON array of rule keys
  decision            TEXT NOT NULL DEFAULT 'none',
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER,
  UNIQUE(session_id, post_id)
);

CREATE INDEX idx_research_candidates_session
  ON research_candidates(session_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_research_candidates_project
  ON research_candidates(project_id, validation_status)
  WHERE deleted_at IS NULL;
