import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  everyValue: z.number().int().positive(),
  everyUnit: z.enum(['minute', 'hour']),
  cron: z.string().optional(),
})

export type ScheduleTriggerConfig = z.infer<typeof ConfigSchema>

export const scheduleTriggerExecutor: Executor<ScheduleTriggerConfig> = {
  type: 'scheduleTrigger',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  // Normally bypassed via seed injection. Fallback for a manual run.
  async run() {
    return { kind: 'trigger', event: 'schedule', firedAt: Date.now() }
  },
}
