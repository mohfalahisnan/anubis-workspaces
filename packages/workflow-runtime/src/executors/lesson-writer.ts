import { z } from 'zod'
import type { Executor } from '../types.js'
import { parseEnvelope } from './_envelope.js'

const ConfigSchema = z.object({
  profileId: z.string().min(1),
  reasoning: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  prompt: z.string().optional(),
  lessonType: z.enum(['mistake', 'lesson']),
  titleTemplate: z.string().optional(),
})

export type LessonWriterConfig = z.infer<typeof ConfigSchema>

const DEFAULT_PROMPTS: Record<'mistake' | 'lesson', string> = {
  mistake: 'The reviewed content was REJECTED. Write a concise lesson capturing the mistake and the rule to avoid it next time; use the reviewer comment as the primary reason. Put the lesson in the `text` field.',
  lesson:  'The reviewed content was APPROVED. Write a concise lesson capturing WHAT made this content work, as a reusable rule. Put the lesson in the `text` field.',
}

/** Pull the reviewer's note out of an upstream human-approval output, if any. */
function reviewerComment(upstream: Record<string, unknown>): string | null {
  for (const value of Object.values(upstream)) {
    if (value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'approval') {
      const n = (value as { notes?: unknown }).notes
      if (typeof n === 'string' && n.trim()) return n.trim()
    }
  }
  return null
}

/** Writes a lesson via an AI conversation and returns the text for downstream nodes. */
export const lessonWriterExecutor: Executor<LessonWriterConfig> = {
  type: 'lessonWriter',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input, ctx) {
    const contextBlocks = Object.entries(input.upstream)
      .map(([src, v]) => `<context source="${src}">\n${JSON.stringify(v, null, 2)}\n</context>`)
      .join('\n')
    const prompt = input.config.prompt ?? DEFAULT_PROMPTS[input.config.lessonType]
    const comment = reviewerComment(input.upstream)
    const commentBlock = comment ? `<reviewer-comment>\n${comment}\n</reviewer-comment>` : ''
    const content = [
      contextBlocks,
      commentBlock,
      'End your reply with EXACTLY one ```anubis-output``` block: { "text": "the lesson" }.',
      prompt,
    ].filter(Boolean).join('\n\n')

    const result = await ctx.conversations.createAndAwaitFirstTurn({
      title: input.config.titleTemplate ?? `Lesson · ${input.nodeId}`,
      profileId: input.config.profileId,
      reasoning: input.config.reasoning,
      content,
      source: 'workflow',
      workflow: { runId: ctx.runId, nodeId: input.nodeId },
    })
    const env = parseEnvelope(result.text)
    const lessonText = env.text || result.text

    return { kind: 'lesson', text: lessonText, conversationId: result.conversationId }
  },
}
