import { describe, it, expect } from 'vitest'
import { openDatabase, tx } from '../../src/db/client.js'

describe('openDatabase', () => {
  it('opens an in-memory database with foreign_keys enabled', () => {
    const db = openDatabase(':memory:')
    const fk = db.pragma('foreign_keys', { simple: true })
    expect(fk).toBe(1)
    db.close()
  })

  it('tx wraps the callback in a transaction', () => {
    const db = openDatabase(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)')
    tx(db, () => {
      db.prepare('INSERT INTO t (id) VALUES (?)').run(1)
      db.prepare('INSERT INTO t (id) VALUES (?)').run(2)
    })
    const count = db.prepare('SELECT count(*) AS n FROM t').get() as { n: number }
    expect(count.n).toBe(2)
    db.close()
  })
})
