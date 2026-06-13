import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Db } from '../../src/db/client.js'
import { ProjectsRepo } from '../../src/db/repositories/projects-repo.js'
import { ProjectWorkspaces } from '../../src/documents/project-workspaces.js'
import { MarkdownDocumentStore } from '../../src/documents/document-store.js'

export function createTestDocuments(db: Db): {
  root: string
  documents: MarkdownDocumentStore
  cleanup(): void
} {
  const root = mkdtempSync(join(tmpdir(), 'anubis-documents-'))
  const projects = new ProjectsRepo(db)
  projects.update('default', { workdir: root })
  const workspaces = new ProjectWorkspaces(projects, join(root, 'managed'))
  workspaces.resolve('default')
  return {
    root,
    documents: new MarkdownDocumentStore(workspaces),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}
