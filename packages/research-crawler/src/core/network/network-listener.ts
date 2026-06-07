import type { CdpSession } from "../chrome/cdp-session.js";
import { isLikelyInstagramDataResponse, isLikelyChatGPTDataResponse } from "./response-filter.js";

export type CapturedNetworkResponse = {
  requestId: string;
  responseUrl: string;
  statusCode?: number;
  contentType?: string;
  bodyText: string;
  bodySize: number;
};

export type CaptureNetworkResponsesOptions = {
  timeoutMs: number;
  maxResponses: number;
  navigateUrl?: string;
  scrollIntervalMs?: number;
  initialDelayMs?: number;
  onCaptured?: (captured: CapturedNetworkResponse[]) => void;
  shouldStop?: (captured: CapturedNetworkResponse[]) => boolean | Promise<boolean>;
};

type CdpResponseReceivedParams = {
  requestId?: unknown;
  response?: {
    url?: unknown;
    status?: unknown;
    mimeType?: unknown;
    headers?: Record<string, unknown>;
  };
};

type CdpLoadingFinishedParams = {
  requestId?: unknown;
};

export async function captureInstagramNetworkResponses(
  session: CdpSession,
  options: CaptureNetworkResponsesOptions
): Promise<CapturedNetworkResponse[]> {
  const responses = new Map<string, {
    responseUrl: string;
    statusCode?: number;
    contentType?: string;
  }>();
  const captured: CapturedNetworkResponse[] = [];
  const pendingReads = new Set<Promise<void>>();

  session.on("Network.responseReceived", (params) => {
    const event = params as CdpResponseReceivedParams;
    const requestId = typeof event.requestId === "string" ? event.requestId : "";
    const responseUrl = typeof event.response?.url === "string" ? event.response.url : "";
    const contentType = getContentType(event.response);
    if (!requestId || !isLikelyInstagramDataResponse(responseUrl, contentType)) return;
    responses.set(requestId, {
      responseUrl,
      statusCode: typeof event.response?.status === "number" ? event.response.status : undefined,
      contentType
    });
  });

  session.on("Network.loadingFinished", (params) => {
    const event = params as CdpLoadingFinishedParams;
    const requestId = typeof event.requestId === "string" ? event.requestId : "";
    const response = responses.get(requestId);
    if (!requestId || !response || captured.length >= options.maxResponses) return;

    const read = readResponseBody(session, requestId, response)
      .then((item) => {
        if (item && captured.length < options.maxResponses) {
          captured.push(item);
          options.onCaptured?.(captured);
        }
      })
      .finally(() => pendingReads.delete(read));
    pendingReads.add(read);
  });

  await session.send("Network.enable");
  if (options.navigateUrl) {
    await session.send("Page.enable");
    await session.send("Page.navigate", { url: options.navigateUrl });
  }

  const scrollIntervalMs = Math.max(250, Math.floor(options.scrollIntervalMs ?? 1000));
  const initialDelayMs = Math.max(0, Math.floor(options.initialDelayMs ?? 1200));

  if (!options.shouldStop) {
    await delay(options.timeoutMs);
  } else {
    const deadline = Date.now() + options.timeoutMs;
    if (initialDelayMs > 0) await delay(initialDelayMs);
    let lastCheckedLength = -1;
    while (Date.now() < deadline) {
      await Promise.allSettled([...pendingReads]);
      if (captured.length !== lastCheckedLength) {
        lastCheckedLength = captured.length;
        if (await options.shouldStop(captured)) break;
      }
      try {
        await session.send("Runtime.evaluate", {
          expression: "window.scrollTo({ top: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight), behavior: 'instant' })"
        });
      } catch {
        // ignore errors if session got closed/detached
      }
      await delay(scrollIntervalMs);
    }
  }

  await Promise.allSettled([...pendingReads]);
  return captured;
}

export async function captureChatGPTNetworkResponses(
  session: CdpSession,
  options: CaptureNetworkResponsesOptions
): Promise<CapturedNetworkResponse[]> {
  const responses = new Map<string, {
    responseUrl: string;
    statusCode?: number;
    contentType?: string;
  }>();
  const captured: CapturedNetworkResponse[] = [];
  const pendingReads = new Set<Promise<void>>();

  session.on("Network.responseReceived", (params) => {
    const event = params as CdpResponseReceivedParams;
    const requestId = typeof event.requestId === "string" ? event.requestId : "";
    const responseUrl = typeof event.response?.url === "string" ? event.response.url : "";
    const contentType = getContentType(event.response);
    if (!requestId || !isLikelyChatGPTDataResponse(responseUrl, contentType)) return;
    responses.set(requestId, {
      responseUrl,
      statusCode: typeof event.response?.status === "number" ? event.response.status : undefined,
      contentType
    });
  });

  session.on("Network.loadingFinished", (params) => {
    const event = params as CdpLoadingFinishedParams;
    const requestId = typeof event.requestId === "string" ? event.requestId : "";
    const response = responses.get(requestId);
    if (!requestId || !response || captured.length >= options.maxResponses) return;

    const read = readResponseBody(session, requestId, response)
      .then((item) => {
        if (item && captured.length < options.maxResponses) {
          captured.push(item);
          options.onCaptured?.(captured);
        }
      })
      .finally(() => pendingReads.delete(read));
    pendingReads.add(read);
  });

  await session.send("Network.enable");
  try {
    await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  } catch {}
  if (options.navigateUrl) {
    await session.send("Page.enable");
    await session.send("Page.navigate", { url: options.navigateUrl });
  }

  const scrollIntervalMs = Math.max(250, Math.floor(options.scrollIntervalMs ?? 1000));
  const initialDelayMs = Math.max(0, Math.floor(options.initialDelayMs ?? 1200));

  if (!options.shouldStop) {
    await delay(options.timeoutMs);
  } else {
    const deadline = Date.now() + options.timeoutMs;
    if (initialDelayMs > 0) await delay(initialDelayMs);
    let lastCheckedLength = -1;
    while (Date.now() < deadline) {
      await Promise.allSettled([...pendingReads]);
      if (captured.length !== lastCheckedLength) {
        lastCheckedLength = captured.length;
        if (await options.shouldStop(captured)) break;
      }
      await delay(scrollIntervalMs);
    }
  }

  await Promise.allSettled([...pendingReads]);
  return captured;
}

async function readResponseBody(
  session: CdpSession,
  requestId: string,
  response: {
    responseUrl: string;
    statusCode?: number;
    contentType?: string;
  }
): Promise<CapturedNetworkResponse | null> {
  try {
    const payload = await session.send<{ body?: unknown; base64Encoded?: unknown }>("Network.getResponseBody", { requestId });
    const bodyText = typeof payload.body === "string"
      ? payload.base64Encoded === true
        ? Buffer.from(payload.body, "base64").toString("utf8")
        : payload.body
      : "";
    if (!bodyText) return null;
    return {
      requestId,
      responseUrl: response.responseUrl,
      statusCode: response.statusCode,
      contentType: response.contentType,
      bodyText,
      bodySize: Buffer.byteLength(bodyText, "utf8")
    };
  } catch {
    return null;
  }
}

function getContentType(response: CdpResponseReceivedParams["response"]): string {
  const header = response?.headers?.["content-type"] ?? response?.headers?.["Content-Type"];
  if (typeof header === "string") return header;
  return typeof response?.mimeType === "string" ? response.mimeType : "";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
