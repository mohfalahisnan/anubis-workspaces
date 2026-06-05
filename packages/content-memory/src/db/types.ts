import type { Database as DbHandle } from 'better-sqlite3'

/** The shared better-sqlite3 handle. Production passes conversation's db here. */
export type Db = DbHandle

/** Structurally identical to conversation's Migration so it can be spliced in. */
export interface Migration {
  version: number
  sql: string
}
