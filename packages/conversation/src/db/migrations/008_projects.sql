CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  emoji       TEXT,
  color       TEXT,
  description TEXT,
  workdir     TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
INSERT INTO projects (id, name, emoji, created_at, updated_at)
  VALUES ('default', 'Default Project', '📁', strftime('%s','now') * 1000, strftime('%s','now') * 1000);
ALTER TABLE competitors       ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id);
ALTER TABLE captured_posts    ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id);
ALTER TABLE conversations     ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id);
ALTER TABLE workflows         ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id);
ALTER TABLE workflow_runs     ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id);
ALTER TABLE workflow_triggers ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id);
ALTER TABLE cron_jobs         ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id);
CREATE INDEX idx_competitors_project    ON competitors(project_id);
CREATE INDEX idx_captured_posts_project ON captured_posts(project_id);
CREATE INDEX idx_conversations_project  ON conversations(project_id);
CREATE INDEX idx_workflows_project      ON workflows(project_id);
CREATE INDEX idx_cron_jobs_project      ON cron_jobs(project_id);
