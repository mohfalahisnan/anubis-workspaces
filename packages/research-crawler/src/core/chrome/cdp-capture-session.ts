import { normalizeChromeOrigin, type ChromeTarget } from "./chrome-connector.js";
import { createLegacySession } from "../browser/legacy-session-adapter.js";
import { browserRegistry } from "../browser/browser-registry.js";
import type { BrowserManager, ConnectFn } from "../browser/browser-manager.js";
import type { Tab } from "../browser/tab.js";
import type { CdpSession } from "./cdp-session.js";

/**
 * Shared lifecycle scaffolding for every CDP capture flow (Instagram, ChatGPT,
 * Qwen). Runs over the multiplexed BrowserManager: it acquires a Tab (a fresh
 * one for openNewTab, or an attach to the target resolveTarget returns) and
 * hands the body a legacy CdpSession bound to that tab. Closes the tab in a
 * finally unless keepTabOpen.
 */

export type ResolveCdpTargetFn = (args: {
  chromeOrigin: string;
  fetchImpl?: typeof fetch;
}) => Promise<ChromeTarget>;

export type GetManagerFn = (args: {
  chromeOrigin: string;
  fetchImpl?: typeof fetch;
  connect?: ConnectFn;
}) => Promise<BrowserManager>;

export type CdpCaptureSessionOptions = {
  chromeOrigin: string | undefined;
  navigateUrl: string | undefined;
  resolveTarget: ResolveCdpTargetFn;
  openNewTab: boolean;
  keepTabOpen: boolean;
  fetchImpl?: typeof fetch;
  /** Browser-level connection factory, forwarded to the manager (tests/Flow injection). */
  connect?: ConnectFn;
  /** Resolve the BrowserManager for this origin. Defaults to the shared browserRegistry. */
  getManager?: GetManagerFn;
  /** Caller-supplied message shown when the tab is found but has no CDP socket. */
  noSocketMessage: string;
};

export type CdpCaptureSessionContext = {
  chromeOrigin: string;
  navigateUrl: string | undefined;
  session: CdpSession;
  target: ChromeTarget;
  /** Present only when openNewTab was true. */
  openedTabId: string | undefined;
};

export type CdpCaptureSessionFailure =
  | { ok: false; reason: "invalid-input"; message: string }
  | { ok: false; reason: "tab-not-found"; message: string };

const defaultGetManager: GetManagerFn = (args) => browserRegistry.get(args);

export async function withCdpCaptureSession<T>(
  opts: CdpCaptureSessionOptions,
  body: (ctx: CdpCaptureSessionContext) => Promise<T>,
): Promise<{ ok: true; result: T } | CdpCaptureSessionFailure> {
  let chromeOrigin: string;
  try {
    chromeOrigin = normalizeChromeOrigin(opts.chromeOrigin);
  } catch (error) {
    return { ok: false, reason: "invalid-input", message: error instanceof Error ? error.message : "Chrome origin is invalid." };
  }

  let manager: BrowserManager;
  try {
    manager = await (opts.getManager ?? defaultGetManager)({
      chromeOrigin,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.connect ? { connect: opts.connect } : {}),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: "tab-not-found", message: `Browser connection is not reachable at ${chromeOrigin}: ${detail}` };
  }

  let tab: Tab;
  let target: ChromeTarget;
  let openedTabId: string | undefined;
  try {
    if (opts.openNewTab && opts.navigateUrl) {
      tab = await manager.newTab(opts.navigateUrl);
      openedTabId = tab.targetId;
      target = { id: tab.targetId, type: "page", url: opts.navigateUrl, webSocketDebuggerUrl: "" };
    } else {
      const resolved = await opts.resolveTarget({ chromeOrigin, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) });
      tab = await manager.attach(resolved);
      target = resolved;
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

  const session = createLegacySession(tab);
  try {
    const result = await body({ chromeOrigin, navigateUrl: opts.navigateUrl, session, target, openedTabId });
    return { ok: true, result };
  } finally {
    if (!opts.keepTabOpen) await tab.close();
  }
}
