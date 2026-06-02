import type {
  ApiHealthResponse,
  ConversationCreateResponse,
  ConversationListResponse,
  ConversationSummary,
  CreateConversationInput,
  CronJobListResponse,
  CronJobSummary,
  MessageListResponse,
  MessageSummary,
  ProfileListResponse,
  ProfileSummary,
  SkillListResponse,
  SkillSummary,
} from '@anubis/shared'

/* ------------------------------------------------------------
   Base URL resolution
   ------------------------------------------------------------ */

export async function getApiBaseUrl(): Promise<string> {
  if (typeof window !== 'undefined' && window.anubis) {
    return window.anubis.backend.getBaseUrl()
  }

  return import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3000'
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = await getApiBaseUrl()
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const body = await response.json() as { error?: unknown }
      if (body.error) {
        detail = typeof body.error === 'string'
          ? body.error
          : JSON.stringify(body.error)
      }
    } catch {
      // swallow — keep the generic detail
    }
    throw new Error(`${path} failed: ${detail}`)
  }

  return response.json() as Promise<T>
}

/* ------------------------------------------------------------
   Endpoints
   ------------------------------------------------------------ */

export function getHealth(): Promise<ApiHealthResponse> {
  return api<ApiHealthResponse>('/health')
}

export async function listProfiles(): Promise<ProfileSummary[]> {
  const r = await api<ProfileListResponse>('/profiles')
  return r.items
}

export async function listConversations(
  opts: { limit?: number; archived?: boolean } = {},
): Promise<ConversationSummary[]> {
  const params = new URLSearchParams()
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  if (opts.archived !== undefined) params.set('archived', String(opts.archived))
  const qs = params.toString()
  const path = qs ? `/conversations?${qs}` : '/conversations'
  const r = await api<ConversationListResponse>(path)
  return r.items
}

export async function getConversation(id: string): Promise<ConversationSummary> {
  const r = await api<{ ok: true; conversation: ConversationSummary }>(
    `/conversations/${encodeURIComponent(id)}`,
  )
  return r.conversation
}

export async function createConversation(
  input: CreateConversationInput,
): Promise<ConversationSummary> {
  const r = await api<ConversationCreateResponse>('/conversations', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return r.conversation
}

export async function listMessages(conversationId: string): Promise<MessageSummary[]> {
  const r = await api<MessageListResponse>(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
  )
  return r.items
}

export async function sendMessage(
  conversationId: string,
  content: string,
): Promise<{ msgId: string; messageId: string }> {
  const r = await api<{ ok: true; msgId: string; messageId: string }>(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    { method: 'POST', body: JSON.stringify({ content }) },
  )
  return { msgId: r.msgId, messageId: r.messageId }
}

export async function cancelConversation(conversationId: string): Promise<void> {
  await api<{ ok: true }>(
    `/conversations/${encodeURIComponent(conversationId)}/cancel`,
    { method: 'POST' },
  )
}

export async function listSkills(): Promise<SkillSummary[]> {
  const r = await api<SkillListResponse>('/skills')
  return r.items
}

export async function listCronJobs(): Promise<CronJobSummary[]> {
  const r = await api<CronJobListResponse>('/cron-jobs')
  return r.items
}
