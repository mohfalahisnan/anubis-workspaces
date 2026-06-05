CREATE TABLE experience_memories (
  id                 TEXT PRIMARY KEY,
  scope              TEXT NOT NULL CHECK (scope IN ('global','workspace','platform','campaign','agent')),
  workspace_id       TEXT REFERENCES brand_workspaces(id),
  platform           TEXT,
  campaign_id        TEXT,
  agent_id           TEXT,
  type               TEXT NOT NULL CHECK (type IN
                       ('mistake','correction','workflow_rule','validation_rule','preference','anti_pattern','lesson')),
  title              TEXT NOT NULL,
  problem            TEXT NOT NULL,
  cause              TEXT,
  correction         TEXT NOT NULL,
  trigger_pattern    TEXT,
  prevention_rule    TEXT,
  severity           TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status             TEXT NOT NULL CHECK (status IN ('candidate','active','reinforced','deprecated','rejected')),
  usage_count        INTEGER NOT NULL DEFAULT 0,
  success_count      INTEGER NOT NULL DEFAULT 0,
  failure_count      INTEGER NOT NULL DEFAULT 0,
  confidence         REAL NOT NULL DEFAULT 0,
  source_run_id      TEXT,
  source_document_id TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX idx_experience_workspace_status ON experience_memories(workspace_id, status);
CREATE INDEX idx_experience_platform ON experience_memories(platform);
