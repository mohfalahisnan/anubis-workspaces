-- Brand owns its workflows. Nullable + NULL default so SQLite permits the
-- REFERENCES clause under foreign_keys=ON; then backfill legacy rows.
ALTER TABLE workflows
  ADD COLUMN workspace_id TEXT REFERENCES brand_workspaces(id) DEFAULT NULL;

UPDATE workflows
  SET workspace_id = 'default-workspace'
  WHERE workspace_id IS NULL;

CREATE INDEX idx_workflows_workspace ON workflows(workspace_id);
