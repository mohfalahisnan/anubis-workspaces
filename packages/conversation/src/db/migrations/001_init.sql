CREATE TABLE conversations (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  agent           TEXT NOT NULL,
  status          TEXT NOT NULL,
  profile_id      TEXT,
  workspace_path  TEXT NOT NULL,
  extra           TEXT NOT NULL DEFAULT '{}',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER
);
CREATE INDEX idx_conversations_updated_at
  ON conversations(updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  msg_id          TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  metadata        TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_messages_convo ON messages(conversation_id, created_at);

CREATE TABLE artifacts (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      TEXT REFERENCES messages(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL,
  tool_name       TEXT NOT NULL,
  call_id         TEXT NOT NULL,
  input           TEXT,
  output          TEXT,
  status          TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_artifacts_convo ON artifacts(conversation_id, created_at);

CREATE TABLE agent_sessions (
  conversation_id  TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  agent            TEXT NOT NULL,
  agent_session_id TEXT NOT NULL,
  model            TEXT,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE profiles (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  source          TEXT NOT NULL,
  agent           TEXT NOT NULL,
  config          TEXT NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  last_used_at    INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_profiles_source_id ON profiles(source, id);

CREATE TABLE profile_overrides (
  profile_id      TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  config_patch    TEXT NOT NULL,
  sort_order      INTEGER,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE cron_jobs (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  schedule        TEXT NOT NULL,
  schedule_desc   TEXT,
  prompt          TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_run_at     INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
