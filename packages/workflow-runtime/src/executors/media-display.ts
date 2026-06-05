import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({})

export type MediaDisplayConfig = z.infer<typeof ConfigSchema>

interface FileValue { kind?: string; path?: unknown; mimeType?: unknown; files?: unknown; value?: unknown }

function fileFromValue(value: unknown): { path: string; mimeType?: string } | null {
  if (!value || typeof value !== 'object') return null
  const v = value as FileValue
  if (v.kind === 'file' && typeof v.path === 'string') {
    return { path: v.path, mimeType: typeof v.mimeType === 'string' ? v.mimeType : undefined }
  }
  if (v.kind === 'files' && Array.isArray(v.files)) {
    for (const item of v.files) {
      const file = fileFromValue(item)
      if (file) return file
    }
  }
  if (v.kind === 'json' && Object.prototype.hasOwnProperty.call(v, 'value')) {
    return fileFromValue(v.value)
  }
  return null
}

function findFirstFile(upstream: Record<string, unknown>): { path: string; mimeType?: string } | null {
  for (const value of Object.values(upstream)) {
    const file = fileFromValue(value)
    if (file) return file
  }
  return null
}

export const mediaDisplayExecutor: Executor<MediaDisplayConfig> = {
  type: 'mediaDisplay',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input) {
    const file = findFirstFile(input.upstream)
    if (!file) throw new Error('mediaDisplay: no file found upstream')
    return { kind: 'file', path: file.path, ...(file.mimeType ? { mimeType: file.mimeType } : {}) }
  },
}
