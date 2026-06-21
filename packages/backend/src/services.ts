import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConversationService, type ConversationStack } from '@anubis/conversation'
import { getBuiltinSkillRoots } from '@anubis/ai-agent'
import { runCronActionJob } from './cron-actions.js'

let stack: ConversationStack | null = null

export function getDataDir(): string {
  if (process.env.ANUBIS_DATA_DIR) return process.env.ANUBIS_DATA_DIR
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, 'Anubis', 'anubis')
  }
  if (process.env.XDG_DATA_HOME) return join(process.env.XDG_DATA_HOME, 'anubis')
  const home = homedir()
  return home ? join(home, '.local', 'share', 'anubis') : join(tmpdir(), 'anubis')
}

export function getStack(): ConversationStack {
  if (stack) return stack
  const dataDir = getDataDir()
  const builtin = getBuiltinSkillRoots()
  const userSkillsRoot = join(dataDir, 'skills')
  stack = createConversationService({
    dataDir,
    skillRoots: {
      autoInject: builtin.autoInject,
      optIn: builtin.optIn,
      user: userSkillsRoot,
      userAutoInject: join(userSkillsRoot, 'auto-inject'),
      userOptIn: join(userSkillsRoot, 'opt-in'),
    },
    backendUrl: () => process.env.ANUBIS_BACKEND_URL,
    cronActionRunner: (job, services) => runCronActionJob(job, services, dataDir),
    // contextPacker removed: context-pack is no longer provided by the knowledge-base
    // (Task C2 will wire up the new in-process engine search here).
  })
  return stack
}

export async function shutdownStack(): Promise<void> {
  if (!stack) return
  await stack.shutdown()
  stack = null
}
