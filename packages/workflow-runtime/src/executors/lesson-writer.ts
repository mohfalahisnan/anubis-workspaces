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
  mistake: 'The reviewed content was REJECTED. Write a concise lesson capturing the mistake and the rule to avoid it next time. Put the lesson in the `text` field.',
  lesson:  'The reviewed content was APPROVED. Write a concise lesson capturing WHAT made this content work, as a reusable rule. Put the lesson in the `text` field.',
}

/**
 * Writes a lesson via an AI conversation and persists it to anubis-core
 * (`experience_memories`, as a `candidate`). The lesson `text` is also returned
 * so a loop-back edge can feed it into the Improve agent on the next iteration.
 */
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
    const content = [
      contextBlocks,
      'End your reply with EXACTLY one ```anubis-output``` block: { "text": "the lesson" }.',
      prompt,
    ].filter(Boolean).join('\n\n')

    const result = await ctx.conversations.createAndAwaitFirstTurn({
      title: input.config.titleTemplate ?? `Lesson · ${input.nodeId}`,
      profileId: input.config.profileId,
      reasoning: input.config.reasoning,
      content,
    })
    const env = parseEnvelope(result.text)
    const lessonText = env.text || result.text

    const mem = ctx.experience.recordCandidate({
      type: input.config.lessonType,
      title: lessonText.slice(0, 80),
      problem: lessonText,
      correction: lessonText,
      severity: 'medium',
      workspaceId: ctx.workspaceId,
      platform: null,
      sourceRunId: ctx.runId,
    })

    return { kind: 'lesson', text: lessonText, memoryId: mem.id, conversationId: result.conversationId }
  },
}
