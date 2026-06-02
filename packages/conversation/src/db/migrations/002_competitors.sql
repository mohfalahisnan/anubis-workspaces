CREATE TABLE competitors (
  id                TEXT PRIMARY KEY,
  handle            TEXT NOT NULL,               -- e.g. '@ali.abdaal' (kept verbatim incl. '@')
  display_name      TEXT,
  niche             TEXT,
  tint              TEXT,                        -- accent colour for the card / avatar
  followers         INTEGER,                     -- null until captured
  avg_likes         INTEGER,                     -- null until captured (dominant-cluster mean)
  post_count        INTEGER NOT NULL DEFAULT 0,
  last_refreshed_at INTEGER,
  notes             TEXT,
  added_at          INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  deleted_at        INTEGER
);
-- Uniqueness only applies to active rows so a removed competitor's
-- handle can be re-added later.
CREATE UNIQUE INDEX uq_competitors_handle_active
  ON competitors(handle) WHERE deleted_at IS NULL;
CREATE INDEX idx_competitors_added_at
  ON competitors(added_at DESC) WHERE deleted_at IS NULL;
