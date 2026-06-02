import type { CdpSession } from "./cdp-session.js";

export type ChromeTarget = {
  id: string;
  type: string;
  url: string;
  title?: string;
  webSocketDebuggerUrl?: string;
};

export type ChromeConnectorOptions = {
  chromeOrigin?: string;
  fetchImpl?: typeof fetch;
  allowAnyPage?: boolean;
  preferredUrl?: string;
  preferredUrlWaitMs?: number;
};

const DEFAULT_CHROME_ORIGIN = "http://127.0.0.1:9222";

export async function resolveInstagramTarget(options: ChromeConnectorOptions = {}): Promise<ChromeTarget> {
  const targets = await listChromeTargetsWaitingForPreferredUrl(options);
  const target = targets.find((candidate) => (
    candidate.type === "page" &&
    candidate.webSocketDebuggerUrl &&
    isSamePageUrl(candidate.url, options.preferredUrl)
  )) ?? targets.find((candidate) => (
    candidate.type === "page" &&
    candidate.webSocketDebuggerUrl &&
    isInstagramUrl(candidate.url)
  )) ?? (options.allowAnyPage ? targets.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl) : undefined);

  if (!target) {
    throw new Error("No Chrome tab with a CDP socket was found.");
  }

  return target;
}

async function listChromeTargetsWaitingForPreferredUrl(options: ChromeConnectorOptions): Promise<ChromeTarget[]> {
  const waitMs = Math.max(0, Math.floor(options.preferredUrlWaitMs ?? 0));
  if (!options.preferredUrl || waitMs === 0) return listChromeTargets(options);

  const deadline = Date.now() + waitMs;
  let targets: ChromeTarget[] = [];
  while (Date.now() < deadline) {
    targets = await listChromeTargets(options);
    if (targets.some((candidate) => (
      candidate.type === "page" &&
      candidate.webSocketDebuggerUrl &&
      isSamePageUrl(candidate.url, options.preferredUrl)
    ))) {
      return targets;
    }
    await delay(200);
  }

  return targets.length > 0 ? targets : listChromeTargets(options);
}

export async function listChromeTargets(options: ChromeConnectorOptions = {}): Promise<ChromeTarget[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const chromeOrigin = normalizeChromeOrigin(options.chromeOrigin);
  const response = await fetchImpl(new URL("/json/list", chromeOrigin));
  if (!response.ok) {
    throw new Error(`Chrome target list failed with status ${response.status}.`);
  }
  const payload = await response.json();
  return Array.isArray(payload) ? payload.filter(isChromeTarget) : [];
}

/** Injectable CDP-session factory (defaults to the real WebSocket connector). */
export type ConnectCdpSession = (webSocketUrl: string) => Promise<CdpSession>;

async function defaultConnectCdpSession(webSocketUrl: string): Promise<CdpSession> {
  const { connectCdpSession } = await import("./cdp-session.js");
  return connectCdpSession(webSocketUrl);
}

export type OpenChromeTabOptions = {
  chromeOrigin?: string;
  fetchImpl?: typeof fetch;
  url: string;
  connectSession?: ConnectCdpSession;
};

export async function openChromeTab(options: OpenChromeTabOptions): Promise<ChromeTarget> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const chromeOrigin = normalizeChromeOrigin(options.chromeOrigin);

  // Path A: PUT /json/new?<url> (fastest; works on older Chrome).
  const putEndpoint = new URL(`/json/new?${encodeURI(options.url)}`, chromeOrigin);
  try {
    const response = await fetchImpl(putEndpoint, { method: "PUT" });
    if (response.ok) {
      const payload = await response.json();
      if (isChromeTarget(payload) && payload.webSocketDebuggerUrl) return payload;
    }
  } catch {
    // fall through to Target.createTarget
  }

  // Path B: Target.createTarget via browser-level WS (modern Chrome).
  return openChromeTabViaTargetCreateTarget({
    chromeOrigin,
    fetchImpl,
    url: options.url,
    connectSession: options.connectSession ?? defaultConnectCdpSession
  });
}

export type CloseChromeTabOptions = {
  chromeOrigin?: string;
  fetchImpl?: typeof fetch;
  targetId: string;
  connectSession?: ConnectCdpSession;
};

export async function closeChromeTab(options: CloseChromeTabOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const chromeOrigin = normalizeChromeOrigin(options.chromeOrigin);
  const endpoint = new URL(`/json/close/${encodeURIComponent(options.targetId)}`, chromeOrigin);
  try {
    const response = await fetchImpl(endpoint);
    if (response.ok) return;
  } catch {
    // fall through to Target.closeTarget
  }
  try {
    await closeChromeTabViaTargetCloseTarget({
      chromeOrigin,
      fetchImpl,
      targetId: options.targetId,
      connectSession: options.connectSession ?? defaultConnectCdpSession
    });
  } catch {
    // best-effort
  }
}

async function getBrowserWebSocketUrl(chromeOrigin: string, fetchImpl: typeof fetch): Promise<string> {
  const versionResponse = await fetchImpl(new URL("/json/version", chromeOrigin));
  if (!versionResponse.ok) {
    throw new Error(`Chrome /json/version failed with status ${versionResponse.status}.`);
  }
  const payload = await versionResponse.json() as { webSocketDebuggerUrl?: string };
  if (typeof payload.webSocketDebuggerUrl !== "string" || !payload.webSocketDebuggerUrl) {
    throw new Error("Chrome /json/version did not return a browser webSocketDebuggerUrl.");
  }
  return payload.webSocketDebuggerUrl;
}

async function openChromeTabViaTargetCreateTarget(input: {
  chromeOrigin: string;
  fetchImpl: typeof fetch;
  url: string;
  connectSession: ConnectCdpSession;
}): Promise<ChromeTarget> {
  const browserWsUrl = await getBrowserWebSocketUrl(input.chromeOrigin, input.fetchImpl);
  const session = await input.connectSession(browserWsUrl);
  try {
    const result = await session.send<{ targetId?: string }>("Target.createTarget", { url: input.url });
    const targetId = typeof result?.targetId === "string" ? result.targetId : "";
    if (!targetId) throw new Error("Target.createTarget did not return a targetId.");
    // Poll /json/list briefly for the new target's webSocketDebuggerUrl.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const targets = await listChromeTargets({ chromeOrigin: input.chromeOrigin, fetchImpl: input.fetchImpl });
      const match = targets.find((candidate) => candidate.id === targetId && candidate.webSocketDebuggerUrl);
      if (match) return match;
      await delay(150);
    }
    throw new Error(`New tab targetId=${targetId} did not expose a webSocketDebuggerUrl within 5s.`);
  } finally {
    session.close();
  }
}

async function closeChromeTabViaTargetCloseTarget(input: {
  chromeOrigin: string;
  fetchImpl: typeof fetch;
  targetId: string;
  connectSession: ConnectCdpSession;
}): Promise<void> {
  const browserWsUrl = await getBrowserWebSocketUrl(input.chromeOrigin, input.fetchImpl);
  const session = await input.connectSession(browserWsUrl);
  try {
    await session.send("Target.closeTarget", { targetId: input.targetId });
  } finally {
    session.close();
  }
}

export function normalizeChromeOrigin(value?: string): string {
  const raw = value?.trim() || DEFAULT_CHROME_ORIGIN;
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Chrome debugging origin must start with http or https.");
  }
  return url.toString();
}

function isInstagramUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === "instagram.com" || url.hostname.endsWith(".instagram.com");
  } catch {
    return false;
  }
}

function isSamePageUrl(left: string, right?: string): boolean {
  if (!right) return false;
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    const normalizePath = (path: string) => path.replace(/\/+$/, "") || "/";
    return leftUrl.hostname === rightUrl.hostname &&
      normalizePath(leftUrl.pathname) === normalizePath(rightUrl.pathname);
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isChromeTarget(value: unknown): value is ChromeTarget {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<ChromeTarget>;
  return typeof record.id === "string" && typeof record.type === "string" && typeof record.url === "string";
}
