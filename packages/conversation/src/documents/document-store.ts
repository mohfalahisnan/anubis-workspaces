import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import matter from 'gray-matter'
import { z } from 'zod'
import type { ProjectWorkspaces } from './project-workspaces.js'
import { walkMarkdown } from './walk-markdown.js'

export type CanonicalDocumentType = 'task' | 'competitor' | 'content' | 'research' | 'brand'

/**
 * Coerce a value that YAML may have parsed as a native `Date` back to an ISO
 * string. gray-matter/js-yaml turns an unquoted ISO timestamp into a `Date`,
 * which a bare `z.string()` would reject; any other value passes through
 * unchanged for the wrapped schema to validate.
 */
const coerceDateToIsoString = (value: unknown): unknown =>
  value instanceof Date ? value.toISOString() : value

const IsoDateString = z.preprocess(coerceDateToIsoString, z.string().datetime())

/** A frontmatter string field that tolerates YAML's native timestamp parsing. */
export const FrontmatterDateString = z.preprocess(coerceDateToIsoString, z.string())

const CommonFrontmatter = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  type: z.enum(['task', 'competitor', 'content', 'research', 'brand']),
  project_id: z.string().min(1),
  created_at: IsoDateString,
  updated_at: IsoDateString,
}).passthrough()

export interface MarkdownDocument {
  path: string
  relativePath: string
  data: Record<string, unknown>
  body: string
}

export class DocumentStoreError extends Error {
  constructor(
    readonly code:
      | 'INVALID_DOCUMENT'
      | 'DUPLICATE_DOCUMENT_ID'
      | 'DUPLICATE_DOCUMENT_FIELD'
      | 'DOCUMENT_PATH_ESCAPE',
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DocumentStoreError'
  }
}

export class MarkdownDocumentStore {
  constructor(private readonly workspaces: ProjectWorkspaces) {}

  list(type: CanonicalDocumentType, root: string, projectId?: string): MarkdownDocument[] {
    const documents: MarkdownDocument[] = []
    const seen = new Map<string, string>()
    for (const id of this.workspaces.projectIds(projectId)) {
      const workspace = this.workspaces.resolve(id)
      const directory = this.safePath(workspace, root)
      for (const path of walkMarkdown(directory)) {
        const document = this.readPath(path, workspace, type, id)
        const documentId = String(document.data.id)
        const previous = seen.get(documentId)
        if (previous) {
          throw new DocumentStoreError(
            'DUPLICATE_DOCUMENT_ID',
            `Duplicate ${type} document id ${documentId}`,
            { id: documentId, paths: [previous, document.relativePath] },
          )
        }
        seen.set(documentId, document.relativePath)
        documents.push(document)
      }
    }
    return documents
  }

  find(type: CanonicalDocumentType, root: string, id: string): MarkdownDocument | null {
    return this.list(type, root).find((document) => document.data.id === id) ?? null
  }

  write(input: {
    type: CanonicalDocumentType
    projectId: string
    root: string
    directory?: string
    id: string
    title: string
    data: Record<string, unknown>
    body: string
    existing?: MarkdownDocument | null
    now?: number
  }): MarkdownDocument {
    const workspace = this.workspaces.resolve(input.projectId)
    const targetDirectory = this.safePath(workspace, join(input.root, input.directory ?? ''))
    mkdirSync(targetDirectory, { recursive: true })
    const realWorkspace = realpathSync.native(workspace)
    const realDirectory = realpathSync.native(targetDirectory)
    if (!isWithin(realWorkspace, realDirectory)) {
      throw new DocumentStoreError(
        'DOCUMENT_PATH_ESCAPE',
        `Document directory escapes workspace: ${relative(workspace, targetDirectory)}`,
      )
    }

    const existing = input.existing ?? this.find(input.type, input.root, input.id)
    const now = new Date(input.now ?? Date.now()).toISOString()
    const data = {
      ...(existing?.data ?? {}),
      ...input.data,
      schema_version: 1,
      id: input.id,
      type: input.type,
      project_id: input.projectId,
      created_at: existing?.data.created_at ?? now,
      updated_at: now,
    }
    CommonFrontmatter.parse(data)

    const filename = existing
      ? basename(existing.path)
      : uniqueFilename(targetDirectory, slugify(input.title), input.id)
    const target = this.safePath(workspace, join(relative(workspace, targetDirectory), filename))
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(temp, matter.stringify(input.body.trim() ? `${input.body.trim()}\n` : '', data), 'utf8')
    renameSync(temp, target)

    if (existing && resolve(existing.path) !== resolve(target) && existsSync(existing.path)) {
      unlinkSync(existing.path)
    }
    return this.readPath(target, workspace, input.type, input.projectId)
  }

  delete(type: CanonicalDocumentType, root: string, id: string): MarkdownDocument | null {
    const document = this.find(type, root, id)
    if (!document) return null
    unlinkSync(document.path)
    return document
  }

  private readPath(
    path: string,
    workspace: string,
    expectedType: CanonicalDocumentType,
    expectedProjectId: string,
  ): MarkdownDocument {
    try {
      const realWorkspace = realpathSync.native(workspace)
      const realPath = realpathSync.native(path)
      if (!isWithin(realWorkspace, realPath)) {
        throw new DocumentStoreError('DOCUMENT_PATH_ESCAPE', `Document escapes workspace: ${path}`)
      }
      const parsed = matter(readFileSync(realPath, 'utf8'))
      const data = CommonFrontmatter.parse(parsed.data)
      if (data.type !== expectedType) throw new Error(`expected type ${expectedType}, found ${data.type}`)
      if (data.project_id !== expectedProjectId) {
        throw new Error(`expected project ${expectedProjectId}, found ${data.project_id}`)
      }
      return {
        path: realPath,
        relativePath: relative(realWorkspace, realPath).replaceAll('\\', '/'),
        data,
        body: parsed.content,
      }
    } catch (error) {
      if (error instanceof DocumentStoreError) throw error
      throw new DocumentStoreError(
        'INVALID_DOCUMENT',
        `Invalid ${expectedType} document ${relative(workspace, path)}: ${error instanceof Error ? error.message : String(error)}`,
        { path },
      )
    }
  }

  private safePath(workspace: string, child: string): string {
    const root = resolve(workspace)
    const target = resolve(root, child)
    if (!isWithin(root, target)) {
      throw new DocumentStoreError('DOCUMENT_PATH_ESCAPE', `Path escapes workspace: ${child}`)
    }
    return target
  }
}

export function parseDocumentData<T>(
  document: MarkdownDocument,
  schema: z.ZodType<T>,
  label: string,
): T {
  try {
    return schema.parse(document.data)
  } catch (error) {
    throw new DocumentStoreError(
      'INVALID_DOCUMENT',
      `Invalid ${label} document ${document.relativePath}: ${error instanceof Error ? error.message : String(error)}`,
      { path: document.relativePath },
    )
  }
}

function isWithin(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`)
}

/**
 * Build the filename for a brand-new document. The stable id already lives in
 * frontmatter, so the filename is presentation only — but it must never collide
 * with an unrelated file (e.g. a manually authored doc sharing the same title
 * slug and id prefix), which a blind write would silently overwrite. Append a
 * numeric suffix until the name is free.
 */
function uniqueFilename(directory: string, slug: string, id: string): string {
  const suffix = id.slice(0, 8)
  let filename = `${slug}-${suffix}.md`
  let counter = 2
  while (existsSync(join(directory, filename))) {
    filename = `${slug}-${suffix}-${counter}.md`
    counter++
  }
  return filename
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 64)
  return slug || 'document'
}
