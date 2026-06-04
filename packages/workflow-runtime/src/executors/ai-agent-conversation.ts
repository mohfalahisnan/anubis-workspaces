import { z } from 'zod'
import type { Executor } from '../types.js'

const ConfigSchema = z.object({
  profileId: z.string().min(1),
  reasoning: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  prompt: z.string().min(1),
  titleTemplate: z.string().optional(),
})

export type AiAgentConversationConfig = z.infer<typeof ConfigSchema>

interface FileShape {
  paths?: string[]
  mediaPaths?: string[]
  kind?: string
  path?: string
}

function collectFiles(value: unknown): string[] {
  if (value == null || typeof value !== 'object') return []
  const v = value as FileShape
  const out: string[] = []
  if (Array.isArray(v.paths)) out.push(...v.paths.filter((p) => typeof p === 'string'))
  if (Array.isArray(v.mediaPaths)) out.push(...v.mediaPaths.filter((p) => typeof p === 'string'))
  if (v.kind === 'file' && typeof v.path === 'string') out.push(v.path)
  return out
}

function composeMessage(upstream: Record<string, unknown>, prompt: string): string {
  const contextBlocks: string[] = []
  const files: string[] = []
  for (const [src, value] of Object.entries(upstream)) {
    files.push(...collectFiles(value))
    contextBlocks.push(`<context source="${src}">\n${JSON.stringify(value, null, 2)}\n</context>`)
  }
  const parts: string[] = []
  if (contextBlocks.length > 0) parts.push(contextBlocks.join('\n'))
  if (files.length > 0) parts.push(`Attached files:\n${files.map((p) => `- ${p}`).join('\n')}`)
  parts.push(prompt)
  return parts.join('\n\n')
}

export const aiAgentConversationExecutor: Executor<AiAgentConversationConfig> = {
  type: 'aiAgentConversation',
  validateConfig(raw) {
    return ConfigSchema.parse(raw)
  },
  async run(input, ctx) {
    const content = composeMessage(input.upstream, input.config.prompt)
    const title = input.config.titleTemplate ?? `Workflow · ${input.nodeId}`
    const result = await ctx.conversations.createAndAwaitFirstTurn({
      title,
      profileId: input.config.profileId,
      reasoning: input.config.reasoning,
      content,
    })
    return {
      kind: 'conversation',
      conversationId: result.conversationId,
      messageId: result.messageId,
      text: result.text,
    }
  },
}
