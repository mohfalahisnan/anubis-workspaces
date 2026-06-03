CREATE TABLE workflows (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT,
  draft_graph       TEXT NOT NULL,
  published_graph   TEXT,
  draft_updated_at  INTEGER NOT NULL,
  published_at      INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE workflow_runs (
  id              TEXT PRIMARY KEY,
  workflow_id     TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
  graph_snapshot  TEXT NOT NULL,
  started_at      INTEGER NOT NULL,
  finished_at     INTEGER,
  error           TEXT
);
CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id, started_at DESC);

CREATE TABLE workflow_run_steps (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id      TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','skipped')),
  started_at   INTEGER,
  finished_at  INTEGER,
  output       TEXT,
  error        TEXT
);
CREATE INDEX idx_workflow_run_steps_run ON workflow_run_steps(run_id);
