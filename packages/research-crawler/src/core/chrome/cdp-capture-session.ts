import { connectCdpSession, type CdpSession } from "./cdp-session.js";
import {
  closeChromeTab,
  normalizeChromeOrigin,
  openChromeTab,
  type ChromeTarget,
} from "./chrome-connector.js";

/**
 * Shared lifecycle scaffolding for every CDP capture flow (Instagram, ChatGPT,
 * Qwen, future platforms). Owns the parts that genuinely repeat across
 * every service:
 *
 *  - chromeOrigin normalisation (and reporting "input invalid" if it throws)
 *  - "open a new tab" vs "reuse an existing tab" target resolution
 *  - the `webSocketDebuggerUrl` presence check
 *  - CDP session connect
 *  - try / finally cleanup: close the session, close the opened tab unless
 *    the caller asked to keep it
 *
 * Each platform service still owns its platform-specific capture logic and its
 * own error-code union (e.g. `INSTAGRAM_TAB_NOT_FOUND` vs
 * `CHATGPT_TAB_NOT_FOUND`); this helper returns a small discriminated result
 * the caller maps onto its own error envelope.
 */

export type ResolveCdpTargetFn = (args: {
  chromeOrigin: string;
  fetchImpl?: typeof fetch;
}) => Promise<ChromeTarget>;

export type CdpCaptureSessionOptions = {
  chromeOrigin: string | undefined;
  /**
   * The URL the capture wants the tab on. When `openNewTab` is true this is
   * the URL of the freshly opened tab. When `openNewTab` is false this may
   * still be set so the caller can react to it (Instagram passes it to its
   * `resolveTarget` reuse logic; ChatGPT only uses it for the
   * `Page.navigate` call inside `body`).
   */
  navigateUrl: string | undefined;
  /** Resolves an existing tab when `openNewTab` is false. */
  resolveTarget: ResolveTargetFn;
  openNewTab: boolean;
  keepTabOpen: boolean;
  fetchImpl?: typeof fetch;
  connectSession?: (url: string) => Promise<CdpSession>;
  /** Caller-supplied message shown when the tab is found but has no CDP socket. */
  noSocketMessage: string;
};

type ResolveTargetFn = ResolveCdpTargetFn;

export type CdpCaptureSessionContext = {
  chromeOrigin: string;
  navigateUrl: string | undefined;
  session: CdpSession;
  target: ChromeTarget;
  /** Present only when `openNewTab` was true. */
  openedTabId: string | undefined;
};

export type CdpCaptureSessionFailure =
  | { ok: false; reason: "invalid-input"; message: string }
  | { ok: false; reason: "tab-not-found"; message: string };

/**
 * Open a CDP session against the configured Chrome instance, hand it to
 * `body`, and clean up no matter how `body` returns. The success value of
 * `body` is propagated as-is; thrown errors propagate too (so the caller can
 * map them onto its own `*_CDP_CAPTURE_FAILED` envelope inside its own
 * try/catch).
 */
export async function withCdpCaptureSession<T>(
  opts: CdpCaptureSessionOptions,
  body: (ctx: CdpCaptureSessionContext) => Promise<T>,
): Promise<{ ok: true; result: T } | CdpCaptureSessionFailure> {
  let chromeOrigin: string;
  try {
    chromeOrigin = normalizeChromeOrigin(opts.chromeOrigin);
  } catch (error) {
    return {
      ok: false,
      reason: "invalid-input",
      message: error instanceof Error ? error.message : "Chrome origin is invalid.",
    };
  }

  let target: ChromeTarget;
  let openedTabId: string | undefined;
  try {
    if (opts.openNewTab && opts.navigateUrl) {
      target = await openChromeTab({
        chromeOrigin,
        fetchImpl: opts.fetchImpl,
        url: opts.navigateUrl,
      });
      openedTabId = target.id;
    } else {
      target = await opts.resolveTarget({
        chromeOrigin,
        fetchImpl: opts.fetchImpl,
      });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: "tab-not-found",
      message: opts.openNewTab
        ? `Failed to open new Chrome tab at ${chromeOrigin}: ${detail}`
        : `Browser data connection is not reachable at ${chromeOrigin}: ${detail}`,
    };
  }

  if (!target.webSocketDebuggerUrl) {
    if (openedTabId) {
      await closeChromeTab({ chromeOrigin, fetchImpl: opts.fetchImpl, targetId: openedTabId });
    }
    return { ok: false, reason: "tab-not-found", message: opts.noSocketMessage };
  }

  const connect = opts.connectSession ?? connectCdpSession;
  let session: CdpSession | null = null;
  try {
    session = await connect(target.webSocketDebuggerUrl);
    const result = await body({
      chromeOrigin,
      navigateUrl: opts.navigateUrl,
      session,
      target,
      openedTabId,
    });
    return { ok: true, result };
  } finally {
    session?.close();
    if (openedTabId && !opts.keepTabOpen) {
      await closeChromeTab({ chromeOrigin, fetchImpl: opts.fetchImpl, targetId: openedTabId });
    }
  }
}
