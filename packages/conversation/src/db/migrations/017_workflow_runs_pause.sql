-- Widen workflow run/step status enums for the pause/branch/loop engine.
-- SQLite cannot ALTER a CHECK constraint; run history is ephemeral local data,
-- so we rebuild the two tables (existing run logs are discarded; workflow
-- definitions in `workflows` are untouched). Drop child before parent.
DROP TABLE IF EXISTS workflow_run_steps;
DROP TABLE IF EXISTS workflow_runs;

CREATE TABLE workflow_runs (
  id              TEXT PRIMARY KEY,
  workflow_id     TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN
                    ('pending','running','awaiting_approval','succeeded','failed','rejected','cancelled')),
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
  status       TEXT NOT NULL CHECK (status IN
                 ('pending','running','awaiting','succeeded','failed','skipped')),
  iteration    INTEGER NOT NULL DEFAULT 0,
  started_at   INTEGER,
  finished_at  INTEGER,
  output       TEXT,
  error        TEXT
);
CREATE INDEX idx_workflow_run_steps_run ON workflow_run_steps(run_id);
