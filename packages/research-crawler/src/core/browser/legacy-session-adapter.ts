import type { CdpSession } from '../chrome/cdp-session.js'
import type { Tab } from './tab.js'

/**
 * Wraps a Tab in the legacy CdpSession interface ({ send, on, close }) so existing
 * consumers (network-listener, platform capture services) can run over the
 * multiplexed BrowserManager transport without code changes. Phase 2 wires this
 * into withCdpCaptureSession.
 */
export function createLegacySession(tab: Tab): CdpSession {
  return {
    send: <T = unknown>(method: string, params?: Record<string, unknown>) => tab.send<T>(method, params),
    on: (method, handler) => { tab.on(method, handler) },
    close: () => { void tab.close() },
  }
}
