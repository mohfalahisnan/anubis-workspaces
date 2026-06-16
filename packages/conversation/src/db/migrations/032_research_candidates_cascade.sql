-- Rebuild research_candidates so its back-references to captured_posts and
-- competitors cascade on delete.
--
-- 024 created `post_id` and `competitor_id` as plain `REFERENCES` with no
-- ON DELETE action (≈ RESTRICT). A research candidate is a self-contained
-- snapshot of the post it scored, but that hard FK meant deleting a captured
-- post — the Research Phase mints one candidate per scored post — failed with
-- "FOREIGN KEY constraint failed" (every post is referenced). The same trap is
-- latent on competitor_id: it only stays dormant because competitors are
-- soft-deleted today.
--
-- captured_posts.competitor_id already cascades from competitors, so a hard
-- competitor delete would cascade into captured_posts and then need the post ->
-- candidate edge to cascade too. Making both edges ON DELETE CASCADE keeps the
-- whole competitor -> post -> candidate chain self-consistent at the DB layer.
-- session_id keeps its existing ON DELETE CASCADE.

CREATE TABLE research_candidates_next (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id),
  session_id          TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
  competitor_id       TEXT NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  post_id             TEXT NOT NULL REFERENCES captured_posts(id) ON DELETE CASCADE,
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
  niche_aligned       INTEGER,
  niche_reason        TEXT,
  validation_status   TEXT NOT NULL,
  validation_failures TEXT,
  decision            TEXT NOT NULL DEFAULT 'none',
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER,
  UNIQUE(session_id, post_id)
);

INSERT INTO research_candidates_next (
  id, project_id, session_id, competitor_id, post_id, platform, post_url, posted_at,
  caption, media_kind, likes, baseline_likes, score, competitor_level, candidate_level,
  niche_aligned, niche_reason, validation_status, validation_failures, decision,
  created_at, updated_at, deleted_at
)
SELECT
  id, project_id, session_id, competitor_id, post_id, platform, post_url, posted_at,
  caption, media_kind, likes, baseline_likes, score, competitor_level, candidate_level,
  niche_aligned, niche_reason, validation_status, validation_failures, decision,
  created_at, updated_at, deleted_at
FROM research_candidates;

DROP TABLE research_candidates;
ALTER TABLE research_candidates_next RENAME TO research_candidates;

CREATE INDEX idx_research_candidates_session
  ON research_candidates(session_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_research_candidates_project
  ON research_candidates(project_id, validation_status)
  WHERE deleted_at IS NULL;
