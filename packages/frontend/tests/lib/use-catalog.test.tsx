import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('@/api', () => ({
  getCatalog: vi.fn(),
}))

import { getCatalog } from '@/api'
import { useCatalog, __resetCatalogCacheForTests } from '@/lib/use-catalog'

const CATALOG = {
  agents: ['claude', 'codex', 'antigravity'] as const,
  models: { claude: [], codex: [], antigravity: [] },
  defaultModel: { claude: 'claude-sonnet-4-6', codex: 'gpt-5.4', antigravity: 'gemini-3.1-pro' },
  reasoningEfforts: ['minimal', 'low', 'medium', 'high'] as const,
  defaultReasoningEffort: 'medium' as const,
}

beforeEach(() => {
  vi.mocked(getCatalog).mockReset()
  __resetCatalogCacheForTests()
})

describe('useCatalog', () => {
  it('fetches once and returns the catalog', async () => {
    vi.mocked(getCatalog).mockResolvedValueOnce(CATALOG)
    const { result } = renderHook(() => useCatalog())
    await waitFor(() => {
      expect(result.current.catalog).toEqual(CATALOG)
    })
    expect(getCatalog).toHaveBeenCalledTimes(1)
  })

  it('shares the cached value across hook calls', async () => {
    vi.mocked(getCatalog).mockResolvedValueOnce(CATALOG)
    const a = renderHook(() => useCatalog())
    await waitFor(() => expect(a.result.current.catalog).toEqual(CATALOG))
    const b = renderHook(() => useCatalog())
    await waitFor(() => expect(b.result.current.catalog).toEqual(CATALOG))
    expect(getCatalog).toHaveBeenCalledTimes(1)
  })

  it('surfaces an error string when fetch fails', async () => {
    vi.mocked(getCatalog).mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => useCatalog())
    await waitFor(() => expect(result.current.error).toBe('boom'))
    expect(result.current.catalog).toBeNull()
  })
})
