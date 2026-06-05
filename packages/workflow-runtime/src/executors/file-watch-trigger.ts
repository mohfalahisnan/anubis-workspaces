import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  path: z.string().min(1),
  watchKind: z.enum(['file', 'folder']),
  glob: z.string().optional(),
  events: z.array(z.enum(['add', 'change', 'unlink'])).min(1),
})

export type FileWatchTriggerConfig = z.infer<typeof ConfigSchema>

export const fileWatchTriggerExecutor: Executor<FileWatchTriggerConfig> = {
  type: 'fileWatchTrigger',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  // A file-watch run only makes sense when armed (the changed path is injected
  // via seed). A manual run has no file context.
  async run() {
    throw new Error('fileWatchTrigger has no file context — run this workflow via an armed trigger')
  },
}
