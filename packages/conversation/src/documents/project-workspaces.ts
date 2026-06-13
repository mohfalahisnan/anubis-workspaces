import {
  copyFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import type { ProjectsRepo } from '../db/repositories/projects-repo.js'
import { ensureWorkspaceStructure } from '../util/workspace.js'
import { walkMarkdown } from './walk-markdown.js'

/** Workspace-relative roots that hold canonical Markdown documents. */
const CANONICAL_DOCUMENT_ROOTS = ['tasks', 'knowledge']

export class ProjectWorkspaces {
  constructor(
    private readonly projects: ProjectsRepo,
    private readonly managedRoot: string,
  ) {}

  resolve(projectId = 'default'): string {
    const project = this.projects.findById(projectId)
    if (!project) {
      throw new ProjectWorkspaceError(
        'PROJECT_NOT_FOUND',
        `Project ${projectId} not found`,
        { projectId },
      )
    }

    const workdir = this.prepare(projectId, project.workdir)
    if (project.workdir !== workdir) this.projects.update(projectId, { workdir })
    return workdir
  }

  /**
   * Resolve a new workspace for an existing project, moving its canonical
   * Markdown documents from the old location so they are not stranded when a
   * project's `workdir` changes. Returns the canonical destination path.
   */
  changeWorkdir(projectId: string, requestedWorkdir?: string): string {
    const project = this.projects.findById(projectId)
    if (!project) {
      throw new ProjectWorkspaceError(
        'PROJECT_NOT_FOUND',
        `Project ${projectId} not found`,
        { projectId },
      )
    }

    const from = canonicalWorkspace(resolve(project.workdir ?? join(this.managedRoot, projectId)))
    const to = this.prepare(projectId, requestedWorkdir)
    if (workspaceKey(from) !== workspaceKey(to) && existsSync(from)) {
      moveCanonicalDocuments(from, to)
    }
    return to
  }

  prepare(projectId: string, requestedWorkdir?: string): string {
    const input = requestedWorkdir ?? join(this.managedRoot, projectId)
    if (!input.trim()) {
      throw new ProjectWorkspaceError('INVALID_PROJECT_WORKSPACE', 'Project workspace cannot be empty')
    }

    const workdir = resolve(input.trim())
    ensureWorkspaceStructure(workdir)
    const canonical = canonicalWorkspace(workdir)

    for (const project of this.projects.list()) {
      if (project.id === projectId) continue
      const other = project.workdir ?? join(this.managedRoot, project.id)
      if (workspaceKey(canonicalWorkspace(other)) === workspaceKey(canonical)) {
        throw new ProjectWorkspaceError(
          'PROJECT_WORKSPACE_CONFLICT',
          `Workspace is already assigned to project ${project.id}`,
          { projectId: project.id, workdir: canonical },
        )
      }
    }

    return canonical
  }

  projectIds(projectId?: string): string[] {
    if (projectId) {
      this.resolve(projectId)
      return [projectId]
    }
    return this.projects.list().map((project) => project.id)
  }
}

export class ProjectWorkspaceError extends Error {
  constructor(
    readonly code: 'INVALID_PROJECT_WORKSPACE' | 'PROJECT_WORKSPACE_CONFLICT' | 'PROJECT_NOT_FOUND',
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ProjectWorkspaceError'
  }
}

function canonicalWorkspace(path: string): string {
  const absolute = resolve(path)
  return existsSync(absolute) ? realpathSync.native(absolute) : absolute
}

function workspaceKey(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

/**
 * Move every canonical Markdown document from one workspace to another,
 * preserving its workspace-relative path. Refuses to overwrite a file that
 * already exists at the destination so a relocation can never clobber content
 * the user placed in the target directory.
 */
function moveCanonicalDocuments(from: string, to: string): void {
  for (const root of CANONICAL_DOCUMENT_ROOTS) {
    const sourceRoot = join(from, root)
    if (!existsSync(sourceRoot)) continue
    for (const file of walkMarkdown(sourceRoot)) {
      const rel = relative(from, file)
      const dest = join(to, rel)
      if (existsSync(dest)) {
        throw new ProjectWorkspaceError(
          'PROJECT_WORKSPACE_CONFLICT',
          `Cannot move workspace document ${rel}: a file already exists at the destination`,
          { document: rel },
        )
      }
      mkdirSync(dirname(dest), { recursive: true })
      moveFile(file, dest)
    }
  }
}

function moveFile(from: string, to: string): void {
  try {
    renameSync(from, to)
  } catch {
    // Cross-device rename (EXDEV) — fall back to copy + unlink.
    copyFileSync(from, to)
    unlinkSync(from)
  }
}
