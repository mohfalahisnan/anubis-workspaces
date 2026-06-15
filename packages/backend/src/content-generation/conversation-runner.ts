import type { AgentKind } from '@anubis/shared'
import type { ConversationStack } from '@anubis/conversation'
import { WEB_AGENTS } from '../agent-run.js'

export interface RunGenerationAgentInput {
  /** A fully-resolved profile id (caller resolves any default chain). */
  profileId: string
  prompt: string
  /** Absolute working dir = the conversation workspace; the agent saves assets here. */
  cwd: string
  /** Conversation title shown in the (filterable) conversation list. */
  title: string
  /** Existing conversation to continue (retry). Omit to start a new one. */
  conversationId?: string
  /** Called with the new conversation id as soon as it's created (before the turn runs). */
  onConversation?: (id: string) => void
}

/**
 * Run a profile agent for media generation as a tracked conversation turn. Creates a
 * `content-generation`-tagged conversation up-front (so its id is persisted before the
 * turn can fail), or continues an existing one on retry. Rejects web agents, which
 * can't run headless media generation.
 */
export async function runGenerationAgent(
  stack: ConversationStack,
  input: RunGenerationAgentInput,
): Promise<{ text: string; agent: AgentKind; conversationId: string }> {
  const resolved = stack.profiles.resolve(input.profileId)
  const agent = resolved.agent
  if (WEB_AGENTS.has(agent)) {
    throw new Error(
      `Profile "${input.profileId}" uses the web agent "${agent}", which can't run headless media generation. `
      + 'Pick a CLI/SDK profile (Claude, Codex, Antigravity, or Qoder).',
    )
  }

  let convId = input.conversationId && stack.conversation.get(input.conversationId)
    ? input.conversationId
    : undefined
  if (!convId) {
    const conv = stack.conversation.create({
      title: input.title,
      profileId: input.profileId,
      workspacePath: input.cwd,
      source: 'content-generation',
      override: { approvalPolicy: 'never', sandboxMode: 'workspace-write', permissionMode: 'bypassPermissions' },
    })
    convId = conv.id
    input.onConversation?.(convId)
  }

  const { text } = await stack.conversation.sendMessageAndAwait(convId, { content: input.prompt })
  return { text, agent, conversationId: convId }
}
