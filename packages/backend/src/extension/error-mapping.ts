import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  ExtensionDispatchError,
  EXTENSION_OFFLINE,
  EXTENSION_TIMEOUT,
  CANCELLED,
} from './job-queue.js'

/**
 * Maps an ExtensionDispatchError to a Hono response with the
 * status code that matches the failure mode. Use from any route
 * that awaits a JobQueue.dispatch().
 */
export function mapExtensionError(c: Context, e: unknown) {
  if (e instanceof ExtensionDispatchError) {
    // 499 (Client Closed Request — Nginx extension) isn't in Hono's
    // ContentfulStatusCode union; map cancel → 408 (Request Timeout)
    // which is the closest standard equivalent.
    const status: ContentfulStatusCode =
      e.code === EXTENSION_OFFLINE ? 503
      : e.code === EXTENSION_TIMEOUT ? 504
      : e.code === CANCELLED ? 408
      : 500
    return c.json({ ok: false, error: { code: e.code, message: e.message } }, status)
  }
  return c.json({
    ok: false,
    error: { code: 'CAPTURE_FAILED', message: e instanceof Error ? e.message : 'unknown' },
  }, 500)
}
