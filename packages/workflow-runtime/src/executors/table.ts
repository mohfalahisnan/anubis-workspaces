import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  staticData: z.array(z.record(z.string(), z.unknown())).optional(),
})

export type TableConfig = z.infer<typeof ConfigSchema>

export const tableExecutor: Executor<TableConfig> = {
  type: 'table',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input) {
    const upstreamValues = Object.values(input.upstream)
    if (upstreamValues.length > 0) return { kind: 'table', rows: upstreamValues }
    return { kind: 'table', rows: input.config.staticData ?? [] }
  },
}
