CREATE TABLE workflow_triggers (
  workflow_id  TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
  armed        INTEGER NOT NULL DEFAULT 0,
  armed_at     INTEGER
);
