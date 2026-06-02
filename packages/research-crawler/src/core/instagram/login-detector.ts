import { connectCdpSession, type CdpSession } from '../chrome/cdp-session.js'
import { normalizeChromeOrigin, resolveInstagramTarget } from '../chrome/chrome-connector.js'

export type InstagramLoginStatus = {
  authenticated: boolean
  userId?: string
  reason?: string
}

export type DetectLoginInput = {
  chromeOrigin?: string
  fetchImpl?: typeof fetch
  connectSession?: (webSocketDebuggerUrl: string) => Promise<CdpSession>
}

export async function detectInstagramLogin(input: DetectLoginInput = {}): Promise<InstagramLoginStatus> {
  let session: CdpSession | null = null
  try {
    const chromeOrigin = normalizeChromeOrigin(input.chromeOrigin)
    const target = await resolveInstagramTarget({ chromeOrigin, fetchImpl: input.fetchImpl, allowAnyPage: true })
    if (!target.webSocketDebuggerUrl) return { authenticated: false, reason: 'No CDP tab available.' }
    session = await (input.connectSession ?? connectCdpSession)(target.webSocketDebuggerUrl)
    const result = await session.send<{ cookies?: Array<{ name?: unknown; value?: unknown }> }>('Network.getCookies', {
      urls: ['https://www.instagram.com/']
    })
    const cookies = Array.isArray(result.cookies) ? result.cookies : []
    const sessionId = cookies.find((cookie) => cookie.name === 'sessionid')
    const userIdCookie = cookies.find((cookie) => cookie.name === 'ds_user_id')
    const authenticated = Boolean(sessionId?.value) && Boolean(userIdCookie?.value)
    return authenticated
      ? { authenticated: true, userId: typeof userIdCookie?.value === 'string' ? userIdCookie.value : undefined }
      : { authenticated: false, reason: 'Missing sessionid or ds_user_id cookie.' }
  } catch (error) {
    return {
      authenticated: false,
      reason: error instanceof Error ? error.message : 'Login detection failed.'
    }
  } finally {
    session?.close()
  }
}
