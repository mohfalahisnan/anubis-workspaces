import { Hono } from 'hono'
import { z } from 'zod'
import { createAiAgentService, type AiAgentService } from '@anubis/ai-agent'
import { getStack } from './services.js'

const agentSchema = z.enum(['codex', 'claude', 'antigravity', 'gpt-web', 'qwen-web', 'qoder'])
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
  profileId: z.string().min(1).optional(),
  prompt: z.string().min(1),
  model: z.string().min(1).optional(),
  claudeCliProfile: z.string().min(1).optional(),
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

// Lazily-initialised so the Qoder API key is picked up from config on first
// use (or re-created after invalidation when the user saves a new key).
let _aiAgentService: AiAgentService | null = null

function getAiAgentService(): AiAgentService {
  if (!_aiAgentService) {
    const cfg = getStack().appConfig.get()
    _aiAgentService = createAiAgentService({ qoderApiKey: cfg.qoderApiKey })
  }
  return _aiAgentService
}

/** Called by the config route whenever qoderApiKey changes. */
export function invalidateAiAgentService(): void {
  _aiAgentService = null
}

export const aiAgentRoutes = new Hono()

aiAgentRoutes.get('/catalog', (c) => {
  return c.json({
    ok: true,
    catalog: getAiAgentService().catalog(),
  })
})

aiAgentRoutes.post('/run', async (c) => {
  const input = runAgentSchema.parse(await c.req.json())
  const cfg = getStack().appConfig.get()
  return c.json(await getAiAgentService().runAgent({ ...input, qoderApiKey: cfg.qoderApiKey }))
})
