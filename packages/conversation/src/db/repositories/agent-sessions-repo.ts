import type { Db } from '../client.js'
import type { AgentSession } from '../../conversations/types.js'

interface Row {
  conversation_id: string
  agent: string
  agent_session_id: string
  model: string | null
  updated_at: number
}

function toSession(r: Row): AgentSession {
  return {
    conversationId: r.conversation_id,
    agent: r.agent as AgentSession['agent'],
    agentSessionId: r.agent_session_id,
    model: r.model ?? undefined,
    updatedAt: r.updated_at,
  }
}

export class AgentSessionsRepo {
  constructor(private db: Db) {}

  upsert(s: AgentSession): void {
    this.db.prepare(`
      INSERT INTO agent_sessions (conversation_id, agent, agent_session_id, model, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        agent=excluded.agent, agent_session_id=excluded.agent_session_id,
        model=excluded.model, updated_at=excluded.updated_at
    `).run(s.conversationId, s.agent, s.agentSessionId, s.model ?? null, s.updatedAt)
  }

  findByConversation(conversationId: string): AgentSession | null {
    const r = this.db.prepare('SELECT * FROM agent_sessions WHERE conversation_id = ?')
      .get(conversationId) as Row | undefined
    return r ? toSession(r) : null
  }
}
