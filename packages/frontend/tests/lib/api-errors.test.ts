import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendMessage, NoCredentialsError } from '@/api'

const ORIG_FETCH = global.fetch

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  global.fetch = ORIG_FETCH
})

describe('sendMessage error handling', () => {
  it('throws NoCredentialsError on 409 no_credentials', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: false, error: { code: 'no_credentials', profileId: 'p1', agent: 'claude' } }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    )
    await expect(sendMessage('cid', 'hi')).rejects.toBeInstanceOf(NoCredentialsError)
  })

  it('NoCredentialsError exposes profileId and agent', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: false, error: { code: 'no_credentials', profileId: 'p1', agent: 'codex' } }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    )
    try {
      await sendMessage('cid', 'hi')
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(NoCredentialsError)
      expect((e as NoCredentialsError).profileId).toBe('p1')
      expect((e as NoCredentialsError).agent).toBe('codex')
    }
  })
})
