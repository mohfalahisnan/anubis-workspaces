import { z } from 'zod'

export const AgentSchema = z.enum(['claude', 'codex', 'antigravity', 'gpt-web', 'qwen-web'])
export type AgentKind = z.infer<typeof AgentSchema>
export const ReasoningEffortSchema = z.enum(['minimal', 'low', 'medium', 'high'])
export const SandboxModeSchema = z.enum(['read-only', 'workspace-write', 'danger-full-access'])
export const ApprovalPolicySchema = z.enum(['untrusted', 'on-request', 'on-failure', 'never'])
export const PermissionModeSchema = z.enum(['default', 'acceptEdits', 'plan', 'bypassPermissions'])
export const ProfileSourceSchema = z.enum(['builtin', 'user'])
export type ProfileSource = z.infer<typeof ProfileSourceSchema>

export const ProfileConfigSchema = z.object({
  agent: AgentSchema,
  model: z.string().min(1).optional(),
  reasoningEffort: ReasoningEffortSchema.optional(),
  sandboxMode: SandboxModeSchema.optional(),
  approvalPolicy: ApprovalPolicySchema.optional(),
  permissionMode: PermissionModeSchema.optional(),
  allowedTools: z.array(z.string().min(1)).optional(),
  disallowedTools: z.array(z.string().min(1)).optional(),
  appendSystemPrompt: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  claudeCliProfile: z.string().min(1).optional(),
  enabledSkills: z.array(z.string().min(1)).optional(),
  disabledBuiltinSkills: z.array(z.string().min(1)).optional(),
  enableContextInjection: z.boolean().optional(),
  contextPackBudget: z.number().int().positive().optional(),
}).strict()

export type ProfileConfig = z.infer<typeof ProfileConfigSchema>

export const ProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  source: ProfileSourceSchema,
  config: ProfileConfigSchema,
  sortOrder: z.number().int(),
  lastUsedAt: z.number().int().optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
}).strict()

export type Profile = z.infer<typeof ProfileSchema>

export const ProfileOverrideSchema = ProfileConfigSchema.partial()
export type ProfileOverride = z.infer<typeof ProfileOverrideSchema>

export type ResolvedProfile = ProfileConfig & { agent: ProfileConfig['agent'] }
