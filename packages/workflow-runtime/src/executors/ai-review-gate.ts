import { z } from 'zod'
import type { Executor } from '../types.js'
import { parseEnvelope } from './_envelope.js'
import { firstUpstreamText } from './_text.js'

const ConfigSchema = z.object({
  profileId: z.string().min(1),
  prompt: z.string().min(1),
  reasoning: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  titleTemplate: z.string().optional(),
  maxIterations: z.number().int().positive().max(20).optional(),
})

export type AiReviewGateConfig = z.infer<typeof ConfigSchema>

export interface AiReviewGateOutput {
  kind: 'approval'
  decision: 'approved' | 'rejected'
  notes?: string
  /** Improvement instruction (reject) or verdict summary (approve). Fed to lessonWriter on reject. */
  text: string
  /** Upstream passed through so the approved branch keeps the refined content. */
  reviewed: Record<string, unknown>
  /** Full parsed review payload (decision, score, checklist, ...). */
  review: unknown
}

/** Output spec appended to the prompt so the agent returns a parseable verdict. */
const REVIEW_OUTPUT_SPEC = [
  '<output-spec>',
  'End your reply with EXACTLY ONE fenced block:',
  '```anubis-output',
  '{ "text": "one-line verdict", "data": { "decision": "approved" | "rejected", "score": 0, "checklist": [{ "label": "", "pass": true }], "rejectionReason": "", "improvementInstruction": "" } }',
  '```',
  'Set data.decision to "approved" ONLY if the content is publish-ready. On "rejected", fill rejectionReason and a concrete improvementInstruction telling the next pass exactly what to fix.',
  '</output-spec>',
].join('\n')

function composeMessage(upstream: Record<string, unknown>, prompt: string): string {
  const contextBlocks = Object.entries(upstream)
    .map(([src, v]) => `<context source="${src}">\n${JSON.stringify(v, null, 2)}\n</context>`)
    .join('\n')
  return [REVIEW_OUTPUT_SPEC, contextBlocks, prompt].filter(Boolean).join('\n\n')
}

function readDecision(data: unknown): { decision: 'approved' | 'rejected'; reason?: string } {
  if (data && typeof data === 'object') {
    const d = data as { decision?: unknown; rejectionReason?: unknown; improvementInstruction?: unknown }
    if (d.decision === 'approved') return { decision: 'approved' }
    if (d.decision === 'rejected') {
      const reason =
        typeof d.rejectionReason === 'string' ? d.rejectionReason
        : typeof d.improvementInstruction === 'string' ? d.improvementInstruction
        : undefined
      return { decision: 'rejected', reason }
    }
  }
  return { decision: 'rejected', reason: 'review did not return a valid decision; treating as rejected' }
}

function improvementText(data: unknown): string | undefined {
  if (data && typeof data === 'object') {
    const d = data as { improvementInstruction?: unknown; rejectionReason?: unknown }
    if (typeof d.improvementInstruction === 'string' && d.improvementInstruction.trim()) return d.improvementInstruction
    if (typeof d.rejectionReason === 'string' && d.rejectionReason.trim()) return d.rejectionReason
  }
  return undefined
}

/**
 * Runs an agent to review upstream content and emits an `approval` envelope.
 * Because the envelope `kind` is `'approval'`, the runner branches on `decision`
 * and reads `maxIterations` here to bound the reject→lesson→refine loop —
 * no runner changes needed.
 */
export const aiReviewGateExecutor: Executor<AiReviewGateConfig> = {
  type: 'aiReviewGate',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input, ctx): Promise<AiReviewGateOutput> {
    const content = composeMessage(input.upstream, input.config.prompt)
    const title = input.config.titleTemplate ?? `Review · ${input.nodeId}`
    const result = await ctx.conversations.createAndAwaitFirstTurn({
      title,
      profileId: input.config.profileId,
      reasoning: input.config.reasoning,
      content,
      source: 'workflow',
      workflow: { runId: ctx.runId, nodeId: input.nodeId },
    })
    const env = parseEnvelope(result.text)
    const { decision, reason } = readDecision(env.data)
    const text =
      decision === 'rejected'
        ? improvementText(env.data) ?? env.text
        : env.text
    return {
      kind: 'approval',
      decision,
      ...(reason ? { notes: reason } : {}),
      text: text || env.text || firstUpstreamText(input.upstream) || '',
      reviewed: input.upstream,
      review: env.data,
    }
  },
}
