import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Migration } from '../migrate.js'

const here = dirname(fileURLToPath(import.meta.url))

function load(version: number, file: string): Migration {
  return { version, sql: readFileSync(join(here, file), 'utf8') }
}

export const MIGRATIONS: Migration[] = [
  load(1, '001_init.sql'),
  load(2, '002_competitors.sql'),
  load(3, '003_captured_posts.sql'),
]
