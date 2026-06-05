-- The first-class Brand/Workspace entity. Source for the context pack's brandContext.
CREATE TABLE brand_workspaces (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  brand_summary TEXT,
  tone_of_voice TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  audience      TEXT NOT NULL DEFAULT '[]',    -- JSON array of strings
  offers        TEXT NOT NULL DEFAULT '[]',    -- JSON array of strings
  constraints   TEXT NOT NULL DEFAULT '[]',    -- JSON array of strings (hard "must avoid")
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Auto-create the default brand that legacy competitors are backfilled to (migration 010).
INSERT OR IGNORE INTO brand_workspaces
  (id, name, brand_summary, tone_of_voice, audience, offers, constraints, status, created_at, updated_at)
VALUES
  ('default-workspace', 'Default Workspace', NULL, '[]', '[]', '[]', '[]', 'active', 0, 0);
