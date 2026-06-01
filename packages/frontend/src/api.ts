import type { ApiHealthResponse } from '@anubis/shared'

export async function getApiBaseUrl() {
  if (window.anubis) {
    return window.anubis.backend.getBaseUrl()
  }

  return import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3000'
}

export async function getHealth() {
  const baseUrl = await getApiBaseUrl()
  const response = await fetch(new URL('/health', baseUrl))

  if (!response.ok) {
    throw new Error(`Backend health check failed with ${response.status}`)
  }

  return response.json() as Promise<ApiHealthResponse>
}
