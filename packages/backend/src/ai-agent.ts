import { Hono } from 'hono'
import { z } from 'zod'
import { createAiAgentService } from '@anubis/ai-agent'

const agentSchema = z.enum(['codex', 'claude'])
const reasoningEffortSchema = z.enum(['minimal', 'low', 'medium', 'high'])
const sandboxModeSchema = z.enum(['read-only', 'workspace-write', 'danger-full-access'])
const approvalPolicySchema = z.enum(['untrusted', 'on-request', 'on-failure', 'never'])
const permissionModeSchema = z.enum(['default', 'acceptEdits', 'plan', 'bypassPermissions'])

const runAgentSchema = z.object({
  agent: agentSchema,
  workspaceId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  prevAgentSessionId: z.string().min(1).optional(),
  cwd: z.string().min(1),
  prompt: z.string().min(1),
  model: z.string().min(1).optional(),
  profile: z.string().min(1).optional(),
  extraEnv: z.record(z.string(), z.string()).optional(),
  appendSystemPrompt: z.string().optional(),
  yolo: z.boolean().optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  sandboxMode: sandboxModeSchema.optional(),
  approvalPolicy: approvalPolicySchema.optional(),
  permissionMode: permissionModeSchema.optional(),
  allowedTools: z.array(z.string().min(1)).optional(),
  disallowedTools: z.array(z.string().min(1)).optional(),
}).strict()

const aiAgentService = createAiAgentService()

export const aiAgentRoutes = new Hono()

aiAgentRoutes.get('/catalog', (c) => {
  return c.json({
    ok: true,
    catalog: aiAgentService.catalog(),
  })
})

aiAgentRoutes.post('/run', async (c) => {
  const input = runAgentSchema.parse(await c.req.json())
  return c.json(await aiAgentService.runAgent(input))
})
