import { describe, expect, it } from 'vitest'
import { z, ZodError } from 'zod'
import { NoCredentialsError } from '@anubis/conversation'
import { NO_CREDENTIALS_ERROR_CODE } from '@anubis/shared'
import { HttpError, toErrorResponse } from '../src/http-errors.js'

describe('toErrorResponse — the backend error seam', () => {
  it('maps a ZodError to a 400 BAD_REQUEST with issues', () => {
    const err = (() => {
      try {
        z.object({ name: z.string() }).parse({})
        return new Error('unreachable')
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(ZodError)

    const { status, body } = toErrorResponse(err)
    expect(status).toBe(400)
    const error = (body as { error: { code: string; issues: unknown[] } }).error
    expect(error.code).toBe('BAD_REQUEST')
    expect(Array.isArray(error.issues)).toBe(true)
  })

  it('passes an HttpError status + body through verbatim', () => {
    const payload = { ok: false, error: { code: 'CAPTURE_FAILED', message: 'boom' } }
    const { status, body } = toErrorResponse(new HttpError(500, payload))
    expect(status).toBe(500)
    expect(body).toEqual(payload)
  })

  it('maps a NoCredentialsError to the 409 credential-gate envelope', () => {
    const { status, body } = toErrorResponse(new NoCredentialsError('profile-1', 'claude'))
    expect(status).toBe(409)
    expect(body).toEqual({
      ok: false,
      error: { code: NO_CREDENTIALS_ERROR_CODE, profileId: 'profile-1', agent: 'claude' },
    })
  })

  it('falls back to 500 INTERNAL_SERVER_ERROR for unknown errors', () => {
    const { status, body } = toErrorResponse(new Error('kaboom'))
    expect(status).toBe(500)
    expect((body as { error: { code: string; message: string } }).error).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'kaboom',
    })
  })
})
