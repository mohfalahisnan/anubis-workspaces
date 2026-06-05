import { getApiBaseUrl } from '@/api'

export interface WorkflowSummary {
  id: string
  name: string
  description?: string
  hasPublished: boolean
  draftAhead: boolean
  draftUpdatedAt: number
  publishedAt?: number
  lastRun?: { id: string; status: string; startedAt: number }
  previewGraph: string
  hasTrigger?: boolean
  armed?: boolean
}

export interface WorkflowDetail {
  id: string
  name: string
  description?: string
  draftGraph: string
  publishedGraph?: string
  draftUpdatedAt: number
  publishedAt?: number
  createdAt: number
  updatedAt: number
  hasTrigger?: boolean
  armed?: boolean
}

export type NodeRunEvent =
  | { kind: 'node-started';   nodeId: string; at: number }
  | { kind: 'node-succeeded'; nodeId: string; at: number; output: unknown }
  | { kind: 'node-failed';    nodeId: string; at: number; error: string }
  | { kind: 'run-started';    runId: string; at: number }
  | { kind: 'run-finished';   runId: string; at: number; status: string; error?: string }

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getApiBaseUrl()
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const text = await res.text()
    throw Object.assign(new Error(text || res.statusText), { status: res.status })
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const workflowsApi = {
  list:        () => jsonFetch<{ items: WorkflowSummary[] }>('/workflows'),
  create:      (name: string, description?: string) =>
                jsonFetch<WorkflowDetail>('/workflows', { method: 'POST', body: JSON.stringify({ name, description }) }),
  get:         (id: string) => jsonFetch<WorkflowDetail>(`/workflows/${id}`),
  patchMeta:   (id: string, patch: { name?: string; description?: string | null }) =>
                jsonFetch<WorkflowDetail>(`/workflows/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  saveDraft:   (id: string, draftGraph: string) =>
                jsonFetch<WorkflowDetail>(`/workflows/${id}/draft`, { method: 'PUT', body: JSON.stringify({ draftGraph }) }),
  publish:     (id: string) => jsonFetch<WorkflowDetail>(`/workflows/${id}/publish`, { method: 'POST' }),
  remove:      (id: string) => jsonFetch<void>(`/workflows/${id}`, { method: 'DELETE' }),
  startRun:    (id: string) => jsonFetch<{ runId: string }>(`/workflows/${id}/runs`, { method: 'POST' }),
  activeRun:   (id: string) => jsonFetch<{ runId: string | null }>(`/workflows/${id}/active-run`),
  listRuns:    (id: string) => jsonFetch<{ items: Array<{ id: string; status: string; startedAt: number }> }>(`/workflows/${id}/runs`),
  getRun:      (runId: string) =>
                jsonFetch<{ run: { id: string; status: string; startedAt: number; finishedAt?: number; error?: string },
                            steps: Array<{ id: string; nodeId: string; status: string; output?: string; error?: string }> }>(`/workflows/runs/${runId}`),
  cancelRun:   (runId: string) => jsonFetch<void>(`/workflows/runs/${runId}`, { method: 'DELETE' }),
  arm:         (id: string) => jsonFetch<{ armed: boolean }>(`/workflows/${id}/arm`, { method: 'POST' }),
  disarm:      (id: string) => jsonFetch<{ armed: boolean }>(`/workflows/${id}/disarm`, { method: 'POST' }),
}

export async function openRunEventStream(
  runId: string,
  onEvent: (event: NodeRunEvent) => void,
): Promise<() => void> {
  const base = await getApiBaseUrl()
  const es = new EventSource(`${base}/workflows/runs/${runId}/events`)
  es.onmessage = (msg) => {
    try {
      const parsed = JSON.parse(msg.data) as NodeRunEvent
      onEvent(parsed)
      if (parsed.kind === 'run-finished') es.close()
    } catch { /* skip malformed */ }
  }
  es.onerror = () => { /* EventSource auto-reconnects */ }
  return () => es.close()
}
