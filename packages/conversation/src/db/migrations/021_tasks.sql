CREATE TABLE tasks (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id),
  title                TEXT NOT NULL,
  description          TEXT,
  status               TEXT NOT NULL CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_review', 'done')),
  priority             TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assignee_profile_id  TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  file_references      TEXT NOT NULL DEFAULT '[]',
  workflow_references  TEXT NOT NULL DEFAULT '[]',
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  deleted_at           INTEGER
);

CREATE INDEX idx_tasks_project_status
  ON tasks(project_id, status, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_tasks_assignee
  ON tasks(assignee_profile_id, updated_at DESC)
  WHERE deleted_at IS NULL;
