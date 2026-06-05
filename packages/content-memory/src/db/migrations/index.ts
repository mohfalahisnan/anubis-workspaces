import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Migration } from '../types.js'

const here = dirname(fileURLToPath(import.meta.url))

function load(version: number, file: string): Migration {
  return { version, sql: readFileSync(join(here, file), 'utf8') }
}

/** Migrations owned by content-memory. Conversation splices these into its runner. */
export const CONTENT_MEMORY_MIGRATIONS: Migration[] = [
  load(8, '008_brand_workspaces.sql'),
  load(9, '009_knowledge_documents.sql'),
  // 10 is owned by @anubis/conversation (competitors ALTER).
  load(11, '011_content_similarity_items.sql'),
]
