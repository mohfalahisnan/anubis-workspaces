import { z } from 'zod'
import { AgentSchema, ProfileOverrideSchema } from '../profiles/types.js'

export const ConversationStatusSchema = z.enum(['pending', 'running', 'finished', 'error'])
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>

export const MessageRoleSchema = z.enum(['user', 'assistant', 'system'])
export type MessageRole = z.infer<typeof MessageRoleSchema>

export const ConversationExtraSchema = z.object({
  skills: z.array(z.string()).default([]),
  overrides: ProfileOverrideSchema.optional(),
  archived: z.boolean().optional(),
}).strict()
export type ConversationExtra = z.infer<typeof ConversationExtraSchema>

export interface Conversation {
  id: string
  title: string
  agent: 'claude' | 'codex'
  status: ConversationStatus
  profileId?: string
  workspacePath: string
  extra: ConversationExtra
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export interface Message {
  id: string
  conversationId: string
  msgId: string
  role: MessageRole
  content: string
  metadata?: Record<string, unknown>
  createdAt: number
}

export interface Artifact {
  id: string
  conversationId: string
  messageId?: string
  kind: 'tool_call'
  toolName: string
  callId: string
  input?: unknown
  output?: unknown
  status: 'running' | 'success' | 'error'
  createdAt: number
  updatedAt: number
}

export interface AgentSession {
  conversationId: string
  agent: 'claude' | 'codex'
  agentSessionId: string
  model?: string
  updatedAt: number
}

export { AgentSchema }
