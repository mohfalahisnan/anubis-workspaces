import { z } from 'zod'
import type { Executor } from '../types.js'
import { firstUpstreamText } from './_text.js'

const ConfigSchema = z.object({
  title: z.string().optional(),
  instructions: z.string().optional(),
  maxIterations: z.number().int().positive().max(20).optional(),
})

export type HumanApprovalConfig = z.infer<typeof ConfigSchema>

export interface HumanApprovalOutput {
  kind: 'approval'
  decision: 'approved' | 'rejected'
  notes?: string
  /** The reviewed text, surfaced top-level so a Markdown node downstream renders it. */
  text: string
  /** The reviewed upstream content, passed through so the taken branch can use it. */
  reviewed: Record<string, unknown>
}

/**
 * Pauses the run and waits for a human decision (via `ctx.approvals.waitFor`,
 * which the run manager parks until a decision endpoint resolves it). The
 * decision becomes the node's output; the scheduler activates only the matching
 * outgoing branch (`sourceHandle === decision`).
 */
export const humanApprovalExecutor: Executor<HumanApprovalConfig> = {
  type: 'humanApproval',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input, ctx) {
    const { decision, notes } = await ctx.approvals.waitFor(input.nodeId, {
      title: input.config.title,
      instructions: input.config.instructions,
      upstream: input.upstream,
    })
    return {
      kind: 'approval',
      decision,
      ...(notes ? { notes } : {}),
      text: firstUpstreamText(input.upstream) ?? '',
      reviewed: input.upstream,
    } satisfies HumanApprovalOutput
  },
}
