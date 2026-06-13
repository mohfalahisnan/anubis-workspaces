import { describe, it, expect, afterEach } from 'vitest'
import { copyFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import { openDatabase } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/migrations/index.js'
import { DocumentStoreError } from '../../src/documents/document-store.js'
import { createTestDocuments } from '../helpers/documents.js'

describe('MarkdownDocumentStore', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

  function setup() {
    const db = openDatabase(':memory:')
    runMigrations(db, MIGRATIONS)
    const context = createTestDocuments(db)
    cleanups.push(() => { db.close(); context.cleanup() })
    return context
  }

  it('preserves unknown frontmatter and follows a manually renamed file by stable id', () => {
    const { root, documents } = setup()
    const created = documents.write({
      type: 'research', projectId: 'default', root: 'knowledge/research', id: 'research-12345678',
      title: 'Initial title', data: { title: 'Initial title', status: 'draft', custom_field: 'keep-me' },
      body: '## Summary\n\nInitial', now: 1_765_000_000_000,
    })
    const renamed = join(root, 'knowledge', 'research', 'renamed-by-user.md')
    renameSync(created.path, renamed)

    const found = documents.find('research', 'knowledge/research', 'research-12345678')!
    documents.write({
      type: 'research', projectId: 'default', root: 'knowledge/research', id: 'research-12345678',
      title: 'Changed title', data: { title: 'Changed title', status: 'final' }, body: found.body, existing: found,
    })

    const parsed = matter(readFileSync(renamed, 'utf8'))
    expect(parsed.data.custom_field).toBe('keep-me')
    expect(parsed.data.title).toBe('Changed title')
    expect(documents.find('research', 'knowledge/research', 'research-12345678')?.path).toBe(renamed)
  })

  it('rejects duplicate stable ids with both paths in the diagnostic', () => {
    const { root, documents } = setup()
    const created = documents.write({
      type: 'research', projectId: 'default', root: 'knowledge/research', id: 'duplicate-id',
      title: 'One', data: { title: 'One', status: 'draft' }, body: '',
    })
    copyFileSync(created.path, join(root, 'knowledge', 'research', 'second.md'))
    expect(() => documents.list('research', 'knowledge/research')).toThrowError(DocumentStoreError)
    try {
      documents.list('research', 'knowledge/research')
    } catch (error) {
      expect((error as DocumentStoreError).code).toBe('DUPLICATE_DOCUMENT_ID')
      expect((error as DocumentStoreError).details?.paths).toHaveLength(2)
    }
  })

  it('reports malformed frontmatter as an invalid document', () => {
    const { root, documents } = setup()
    const path = join(root, 'knowledge', 'research', 'bad.md')
    writeFileSync(path, '---\nid: missing-common-fields\n---\nBad', 'utf8')
    expect(() => documents.list('research', 'knowledge/research')).toThrowError(
      expect.objectContaining({ code: 'INVALID_DOCUMENT' }),
    )
  })

  it('accepts standard unquoted YAML timestamps from manually authored documents', () => {
    const { root, documents } = setup()
    const path = join(root, 'knowledge', 'research', 'manual.md')
    writeFileSync(path, `---
schema_version: 1
id: manual-research
type: research
project_id: default
created_at: 2026-06-13T00:00:00.000Z
updated_at: 2026-06-13T01:00:00.000Z
title: Manual research
status: draft
---
## Summary

Written by hand.
`, 'utf8')

    const document = documents.find('research', 'knowledge/research', 'manual-research')!
    expect(document.data.created_at).toBe('2026-06-13T00:00:00.000Z')
    expect(document.data.updated_at).toBe('2026-06-13T01:00:00.000Z')
  })
})
