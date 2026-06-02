import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConversationService, type ConversationStack } from '@anubis/conversation'
import { getBuiltinSkillRoots } from '@anubis/ai-agent'

let stack: ConversationStack | null = null

export function getStack(): ConversationStack {
  if (stack) return stack
  const dataDir = process.env.ANUBIS_DATA_DIR ?? join(tmpdir(), 'anubis')
  const builtin = getBuiltinSkillRoots()
  stack = createConversationService({
    dataDir,
    skillRoots: {
      autoInject: builtin.autoInject,
      optIn: builtin.optIn,
      user: join(dataDir, 'skills'),
    },
  })
  return stack
}

export async function shutdownStack(): Promise<void> {
  if (!stack) return
  await stack.shutdown()
  stack = null
}
