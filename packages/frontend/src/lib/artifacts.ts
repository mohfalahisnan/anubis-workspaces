import { getApiBaseUrl } from '@/api'

/**
 * Build an absolute URL that streams a workflow-run artifact through the
 * backend. Works in both browser-dev and packaged Electron without the
 * `file://` security restrictions Electron's renderer imposes.
 */
export async function artifactUrl(absolutePath: string): Promise<string> {
  const base = await getApiBaseUrl()
  return `${base}/workflows/artifacts?path=${encodeURIComponent(absolutePath)}`
}

export async function conversationFileUrl(conversationId: string, path: string): Promise<string> {
  const base = await getApiBaseUrl()
  return `${base}/conversations/${encodeURIComponent(conversationId)}/files?path=${encodeURIComponent(path)}`
}
