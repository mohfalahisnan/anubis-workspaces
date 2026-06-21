import { resolve, sep } from 'node:path'
import { ValidationError } from './types.js'

/** Validate a user/agent-supplied document path. Returns the normalized
    forward-slashed relative path. Mirrors engine_fs.reject_bad_document_path. */
export function rejectBadDocumentPath(rawPath: string): string {
  if (!rawPath || !rawPath.trim()) throw new ValidationError('path must not be empty')
  const normalized = rawPath.trim().replace(/\\/g, '/')
  if (normalized.startsWith('/')) throw new ValidationError('path must be relative to the knowledge root')
  if (/^[A-Za-z]:/.test(normalized)) throw new ValidationError('path must not include a Windows drive')
  const parts = normalized.split('/').filter(p => p.length > 0)
  if (parts.some(p => p === '..')) throw new ValidationError('path must not contain ..')
  if (parts.length === 0) throw new ValidationError('path must include a file name')
  if (!parts[parts.length - 1].toLowerCase().endsWith('.md')) throw new ValidationError('path must point to a .md file')
  return parts.join('/')
}

/** Resolve a validated relative path to an absolute path guaranteed to live
    inside sourceRoot. Mirrors engine_fs.validate_target_path. */
export function resolveTargetPath(sourceRoot: string, rawPath: string): string {
  const relative = rejectBadDocumentPath(rawPath)
  const rootResolved = resolve(sourceRoot)
  const target = resolve(sourceRoot, relative)
  if (target !== rootResolved && !target.startsWith(rootResolved + sep)) {
    throw new ValidationError('path resolved outside the knowledge root')
  }
  return target
}
