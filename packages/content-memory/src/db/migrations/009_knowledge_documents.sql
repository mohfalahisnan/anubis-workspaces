-- Scoped knowledge store. scope/workspace_id/platform are filtered BEFORE ranking.
CREATE TABLE knowledge_documents (
  id             TEXT PRIMARY KEY,
  scope          TEXT NOT NULL CHECK (scope IN ('global', 'workspace')),
  workspace_id   TEXT REFERENCES brand_workspaces(id),
  platform       TEXT,                       -- NULL = applies to all platforms
  source_type    TEXT NOT NULL,
  title          TEXT NOT NULL,
  extracted_text TEXT NOT NULL,
  summary        TEXT,
  tags           TEXT NOT NULL DEFAULT '[]', -- JSON array
  topics         TEXT NOT NULL DEFAULT '[]', -- JSON array
  entities       TEXT NOT NULL DEFAULT '[]', -- JSON array
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'archived', 'deprecated')),
  content_hash   TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  -- Enforce spec §9.1: global ⇒ no workspace; workspace ⇒ has workspace.
  CHECK (
    (scope = 'global' AND workspace_id IS NULL)
    OR (scope = 'workspace' AND workspace_id IS NOT NULL)
  )
);

CREATE INDEX idx_knowledge_documents_scope
  ON knowledge_documents(scope, workspace_id);
CREATE INDEX idx_knowledge_documents_platform
  ON knowledge_documents(platform);
