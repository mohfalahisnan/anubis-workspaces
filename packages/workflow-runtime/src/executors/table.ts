import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  staticData: z.array(z.record(z.string(), z.unknown())).optional(),
})

export type TableConfig = z.infer<typeof ConfigSchema>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function rowsFromValue(value: unknown): unknown[] {
  if (isRecord(value) && value.kind === 'json' && Object.prototype.hasOwnProperty.call(value, 'value')) {
    return rowsFromValue(value.value)
  }
  if (isRecord(value) && value.kind === 'table' && Array.isArray(value.rows)) {
    return value.rows
  }
  if (Array.isArray(value)) return value
  return [value]
}

export const tableExecutor: Executor<TableConfig> = {
  type: 'table',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input) {
    const upstreamValues = Object.values(input.upstream)
    if (upstreamValues.length > 0) return { kind: 'table', rows: upstreamValues.flatMap(rowsFromValue) }
    return { kind: 'table', rows: input.config.staticData ?? [] }
  },
}
