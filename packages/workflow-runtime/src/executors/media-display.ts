import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({})

export type MediaDisplayConfig = z.infer<typeof ConfigSchema>

interface FileValue { kind?: string; path?: unknown; mimeType?: unknown }

function findFirstFile(upstream: Record<string, unknown>): { path: string; mimeType?: string } | null {
  for (const value of Object.values(upstream)) {
    if (value && typeof value === 'object') {
      const v = value as FileValue
      if (v.kind === 'file' && typeof v.path === 'string') {
        return { path: v.path, mimeType: typeof v.mimeType === 'string' ? v.mimeType : undefined }
      }
    }
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
