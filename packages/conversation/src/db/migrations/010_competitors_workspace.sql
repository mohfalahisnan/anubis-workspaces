-- Brand owns its competitor set. Added nullable with a NULL default so SQLite
-- permits the REFERENCES clause under foreign_keys=ON; then backfill legacy rows.
ALTER TABLE competitors
  ADD COLUMN workspace_id TEXT REFERENCES brand_workspaces(id) DEFAULT NULL;

UPDATE competitors
  SET workspace_id = 'default-workspace'
  WHERE workspace_id IS NULL;

CREATE INDEX idx_competitors_workspace
  ON competitors(workspace_id) WHERE deleted_at IS NULL;
