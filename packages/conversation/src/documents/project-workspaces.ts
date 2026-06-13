import { existsSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ProjectsRepo } from '../db/repositories/projects-repo.js'
import { ensureWorkspaceStructure } from '../util/workspace.js'

export class ProjectWorkspaces {
  constructor(
    private readonly projects: ProjectsRepo,
    private readonly managedRoot: string,
  ) {}

  resolve(projectId = 'default'): string {
    const project = this.projects.findById(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)

    const workdir = this.prepare(projectId, project.workdir)
    if (project.workdir !== workdir) this.projects.update(projectId, { workdir })
    return workdir
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
    readonly code: 'INVALID_PROJECT_WORKSPACE' | 'PROJECT_WORKSPACE_CONFLICT',
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
