import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CONTENT_MEMORY_MIGRATIONS } from '@anubis/content-memory'
import type { Migration } from '../migrate.js'

const here = dirname(fileURLToPath(import.meta.url))

function load(version: number, file: string): Migration {
  return { version, sql: readFileSync(join(here, file), 'utf8') }
}

export const MIGRATIONS: Migration[] = [
  load(1, '001_init.sql'),
  load(2, '002_competitors.sql'),
  load(3, '003_captured_posts.sql'),
  load(4, '004_workflows.sql'),
  load(5, '005_competitors_bio_level.sql'),
  load(6, '006_workflow_triggers.sql'),
  load(7, '007_known_workspaces.sql'),
  // content-memory owns 8–9 (brand_workspaces, knowledge_documents).
  ...CONTENT_MEMORY_MIGRATIONS,
  // 010 alters competitors and depends on brand_workspaces existing (8).
  load(10, '010_competitors_workspace.sql'),
  // 016 alters workflows and depends on brand_workspaces existing (8).
  load(16, '016_workflows_workspace.sql'),
  // 017 widens workflow run/step status enums (pause/branch/loop engine).
  load(17, '017_workflow_runs_pause.sql'),
]
