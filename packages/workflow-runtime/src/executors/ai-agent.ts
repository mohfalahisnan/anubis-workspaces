import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  profileId: z.string().min(1),
  reasoning: z.enum(['low', 'medium', 'high']),
  prompt: z.string(),
})

export type AiAgentConfig = z.infer<typeof ConfigSchema>

export const aiAgentExecutor: Executor<AiAgentConfig> = {
  type: 'aiAgent',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input, ctx) {
    const upstreamBlock = JSON.stringify(input.upstream, null, 2)
    const composedPrompt = `<context>\n${upstreamBlock}\n</context>\n\n${input.config.prompt}`
    const result = await ctx.agent.run({
      profileId: input.config.profileId,
      reasoning: input.config.reasoning,
      prompt: composedPrompt,
    })
    return { kind: 'text', text: result.text }
  },
}
