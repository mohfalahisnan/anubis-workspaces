CREATE TABLE known_workspaces (
  path         TEXT PRIMARY KEY,
  last_used_at INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
