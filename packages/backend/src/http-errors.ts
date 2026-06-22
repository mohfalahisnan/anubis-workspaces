import { ZodError } from 'zod'
import { DocumentStoreError, NoCredentialsError, ProjectWorkspaceError } from '@anubis/conversation'
import { NO_CREDENTIALS_ERROR_CODE } from '@anubis/shared'

/** The HTTP statuses the backend's error seam can produce. */
export type HttpErrorStatus = 400 | 403 | 404 | 409 | 415 | 500

/**
 * A typed domain error carrying its own HTTP status and response body. A route
 * (or a helper it calls) `throw`s one of these instead of hand-rolling a
 * `c.json(body, status)`; the single `app.onError` seam maps it. The body is
 * passed through verbatim, so converting an existing inline error response to
 * an `HttpError` keeps the JSON envelope byte-for-byte identical.
 */
export class HttpError extends Error {
  constructor(
    readonly status: HttpErrorStatus,
    readonly body: Record<string, unknown>,
  ) {
    super('HttpError')
    this.name = 'HttpError'
  }
}

/**
 * Map any thrown value to the HTTP status + JSON body the backend should
 * return. This is the whole error-normalization policy in one pure function —
 * its interface is the test surface, so each branch (validation, typed domain
 * error, credential gate, unknown) is asserted directly rather than through a
 * live route. `app.onError` is the only caller.
 */
export function toErrorResponse(error: unknown): {
  status: HttpErrorStatus
  body: Record<string, unknown>
} {
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'Invalid request body.', issues: error.issues },
      },
    }
  }

  if (error instanceof HttpError) {
    return { status: error.status, body: error.body }
  }

  // @anubis/knowledge-lite ValidationError: bad path or query input → 400
  if (error instanceof Error && error.name === 'ValidationError') {
    return {
      status: 400,
      body: { ok: false, error: { code: 'VALIDATION_ERROR', message: error.message } },
    }
  }

  if (error instanceof DocumentStoreError) {
    return {
      status: error.code.startsWith('DUPLICATE_') ? 409 : 400,
      body: {
        ok: false,
        error: { code: error.code, message: error.message, details: error.details },
      },
    }
  }

  if (error instanceof ProjectWorkspaceError) {
    return {
      status: error.code === 'PROJECT_WORKSPACE_CONFLICT'
        ? 409
        : error.code === 'PROJECT_NOT_FOUND'
          ? 404
          : 400,
      body: {
        ok: false,
        error: { code: error.code, message: error.message, details: error.details },
      },
    }
  }

  if (error instanceof NoCredentialsError) {
    return {
      status: 409,
      body: {
        ok: false,
        error: { code: NO_CREDENTIALS_ERROR_CODE, profileId: error.profileId, agent: error.agent },
      },
    }
  }

  return {
    status: 500,
    body: {
      ok: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    },
  }
}
