import type { CdpSession } from "../chrome/cdp-session.js";
import type { BrowserManager, ConnectFn } from "../browser/browser-manager.js";
import { resolveInstagramTarget } from "../chrome/chrome-connector.js";
import { withCdpCaptureSession } from "../chrome/cdp-capture-session.js";
import {
  collectInstagramRecordsFromResponses,
  extractInstagramShortcode,
  type InstagramMediaRecord,
  type InstagramProfileRecord,
  type InstagramRawJsonResponse
} from "../instagram/instagram-json-scanner.js";
import { captureInstagramNetworkResponses } from "../network/network-listener.js";
import { silentReporter, type ProgressReporter } from "../progress/progress-reporter.js";

export type InstagramCdpCaptureInput = {
  chromeOrigin?: string;
  username?: string;
  url?: string;
  timeoutMs?: number;
  maxResponses?: number;
  reporter?: ProgressReporter;
  phaseLabel?: string;
  openNewTab?: boolean;
  scrollIntervalMs?: number;
  initialDelayMs?: number;
  keepTabOpen?: boolean;
};

export type InstagramCdpCaptureSuccess = {
  ok: true;
  profiles: InstagramProfileRecord[];
  media: InstagramMediaRecord[];
  rawResponses: InstagramRawResponseRecord[];
  meta: {
    chromeOrigin: string;
    tabUrl: string;
    matchedResponses: number;
    parsedResponses: number;
    startedAt: string;
    completedAt: string;
  };
};

export type InstagramRawResponseRecord = {
  responseUrl: string;
  statusCode?: number;
  contentType?: string;
  bodySize: number;
  body: unknown;
};

export type InstagramCdpCaptureFailure = {
  ok: false;
  error: {
    code: "CHROME_CDP_UNAVAILABLE" | "INSTAGRAM_TAB_NOT_FOUND" | "INSTAGRAM_CDP_CAPTURE_FAILED";
    message: string;
  };
};

export type InstagramCdpCaptureResult = InstagramCdpCaptureSuccess | InstagramCdpCaptureFailure;

export type InstagramCdpCaptureService = {
  capture(input: InstagramCdpCaptureInput): Promise<InstagramCdpCaptureResult>;
};

export type InstagramCdpCaptureServiceOptions = {
  fetchImpl?: typeof fetch;
  connect?: ConnectFn;
  getManager?: (args: { chromeOrigin: string; fetchImpl?: typeof fetch; connect?: ConnectFn }) => Promise<BrowserManager>;
};

export function createInstagramCdpCaptureService(
  options: InstagramCdpCaptureServiceOptions = {}
): InstagramCdpCaptureService {
  return {
    async capture(input) {
      const startedAt = new Date().toISOString();
      let navigateUrl: string | undefined;

      try {
        navigateUrl = getInstagramNavigateUrl(input);
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "INSTAGRAM_CDP_CAPTURE_FAILED",
            message: error instanceof Error ? error.message : "Instagram CDP capture input is invalid."
          }
        };
      }

      let urlUsername: string | undefined;
      if (input.url) {
        try {
          const parsedUrl = new URL(input.url.trim());
          const parts = parsedUrl.pathname.split('/').filter(Boolean);
          const firstPart = parts[0];
          if (firstPart && firstPart !== 'p' && firstPart !== 'reel') {
            urlUsername = firstPart.toLowerCase();
          }
        } catch {}
      }
      const targetUsername = input.username
        ? input.username.trim().replace(/^@/, "").toLowerCase()
        : urlUsername;
      const targetShortcode = input.url ? extractInstagramShortcode(input.url.trim()) : undefined;

      const reporter: ProgressReporter = input.reporter ?? silentReporter();
      const phase = input.phaseLabel ?? `capture${input.username ? `:${input.username}` : ''}`;
      const allowAnyPage = Boolean(navigateUrl);
      let sessionResult: Awaited<ReturnType<typeof withCdpCaptureSession<InstagramCdpCaptureSuccess>>>;
      try {
        sessionResult = await withCdpCaptureSession<InstagramCdpCaptureSuccess>(
        {
          chromeOrigin: input.chromeOrigin,
          navigateUrl,
          openNewTab: Boolean(input.openNewTab),
          keepTabOpen: Boolean(input.keepTabOpen),
          fetchImpl: options.fetchImpl,
          ...(options.connect ? { connect: options.connect } : {}),
          ...(options.getManager ? { getManager: options.getManager } : {}),
          resolveTarget: ({ chromeOrigin, fetchImpl }) =>
            resolveInstagramTarget({ chromeOrigin, fetchImpl, allowAnyPage }),
          noSocketMessage: "Open Instagram in the browser started from Browser Intelligence."
        },
        async ({ chromeOrigin, session: activeSession, target, openedTabId }) => {
          const sourceUrl = navigateUrl ?? target.url;
          const targetPosts = normalizePositiveInteger(input.maxResponses, 30);
          reporter.start(phase, targetPosts);

          const captured = await captureInstagramNetworkResponses(activeSession, {
          timeoutMs: normalizePositiveInteger(input.timeoutMs, 8000),
          maxResponses: Math.max(100, targetPosts * 2),
          ...(openedTabId ? {} : { navigateUrl }),
          ...(input.scrollIntervalMs ? { scrollIntervalMs: input.scrollIntervalMs } : {}),
          ...(input.initialDelayMs !== undefined ? { initialDelayMs: input.initialDelayMs } : {}),
          onCaptured: (capturedList) => {
            if (targetShortcode) {
              const collected = collectInstagramRecordsFromResponses(parseJsonResponses(capturedList));
              const matched = collected.media.filter(
                (m) => extractInstagramShortcode(m.postUrl) === targetShortcode
              );
              reporter.update(phase, matched.length, 'posts');
            } else if (targetUsername) {
              const parsed = parseJsonResponses(capturedList);
              const collected = collectInstagramRecordsFromResponses(parsed);
              const matchingPosts = collected.media.filter(
                (m) => m.username.toLowerCase() === targetUsername
              );
              reporter.update(phase, matchingPosts.length, 'posts');
            } else {
              reporter.update(phase, capturedList.length, 'responses');
            }
          },
          shouldStop: async (capturedList) => {
            if (targetShortcode) {
              const networkCollected = collectInstagramRecordsFromResponses(parseJsonResponses(capturedList));
              if (networkCollected.media.some((m) => extractInstagramShortcode(m.postUrl) === targetShortcode)) {
                return true;
              }
              // Single-post pages server-side render the post into the document HTML
              // rather than a JSON XHR, so read the embedded JSON straight from the DOM.
              const embedded = await extractEmbeddedPostResponses(activeSession, targetShortcode, sourceUrl);
              const domCollected = collectInstagramRecordsFromResponses(embedded);
              const found = domCollected.media.some((m) => extractInstagramShortcode(m.postUrl) === targetShortcode);
              if (found) reporter.update(phase, 1, 'posts');
              return found;
            }
            if (!targetUsername) return false;
            const parsed = parseJsonResponses(capturedList);
            const collected = collectInstagramRecordsFromResponses(parsed);
            const matchingPosts = collected.media.filter(
              (m) => m.username.toLowerCase() === targetUsername
            );
            const profile = collected.profiles.find(
              (p) => p.username.toLowerCase() === targetUsername
            );

            if (matchingPosts.length >= targetPosts) {
              return true;
            }
            if (profile && typeof profile.postCount === "number" && matchingPosts.length >= profile.postCount) {
              return true;
            }
            return false;
          }
          });
          reporter.done(phase);
          const parsedResponses = parseJsonResponses(captured);
          const scannerInput = [...parsedResponses];
          if (targetShortcode) {
            scannerInput.push(...await extractEmbeddedPostResponses(activeSession, targetShortcode, sourceUrl));
          }
          const collected = collectInstagramRecordsFromResponses(scannerInput, startedAt);

          const success: InstagramCdpCaptureSuccess = {
            ok: true,
            ...collected,
            rawResponses: parsedResponses.map((response) => ({
              responseUrl: response.responseUrl,
              statusCode: response.statusCode,
              contentType: response.contentType,
              bodySize: response.bodySize,
              body: response.body
            })),
            meta: {
              chromeOrigin,
              tabUrl: navigateUrl ?? target.url,
              matchedResponses: captured.length,
              parsedResponses: parsedResponses.length,
              startedAt,
              completedAt: new Date().toISOString()
            }
          };
          return success;
        }
      );
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "INSTAGRAM_CDP_CAPTURE_FAILED",
            message: error instanceof Error ? error.message : "Instagram CDP capture failed."
          }
        };
      }

      if (!sessionResult.ok) {
        if (sessionResult.reason === "invalid-input") {
          return {
            ok: false,
            error: { code: "INSTAGRAM_CDP_CAPTURE_FAILED", message: sessionResult.message }
          };
        }
        return {
          ok: false,
          error: { code: "INSTAGRAM_TAB_NOT_FOUND", message: sessionResult.message }
        };
      }
      return sessionResult.result;
    }
  };
}

function parseJsonResponses(responses: Array<{
  responseUrl: string;
  statusCode?: number;
  contentType?: string;
  bodyText: string;
  bodySize: number;
}>): Array<InstagramRawJsonResponse & {
  statusCode?: number;
  contentType?: string;
  bodySize: number;
}> {
  const parsed: Array<InstagramRawJsonResponse & {
    statusCode?: number;
    contentType?: string;
    bodySize: number;
  }> = [];
  for (const response of responses) {
    try {
      parsed.push({
        responseUrl: response.responseUrl,
        statusCode: response.statusCode,
        contentType: response.contentType,
        bodySize: response.bodySize,
        body: JSON.parse(response.bodyText) as unknown
      });
    } catch {
      // Keep capture alive when one response is not JSON.
    }
  }
  return parsed;
}

type ParsedJsonResponse = InstagramRawJsonResponse & {
  statusCode?: number;
  contentType?: string;
  bodySize: number;
};

/**
 * Reads `<script type="application/json">` blobs from the live page that mention
 * the target shortcode and parses them. Instagram server-side renders single-post
 * data into these blobs instead of a JSON XHR, so network sniffing alone misses it.
 */
async function extractEmbeddedPostResponses(
  session: CdpSession,
  shortcode: string,
  sourceUrl: string
): Promise<ParsedJsonResponse[]> {
  const literal = JSON.stringify(shortcode);
  let value: unknown;
  try {
    const evaluated = await session.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
      expression: `JSON.stringify([...document.querySelectorAll('script[type="application/json"]')].map((s) => s.textContent).filter((t) => t && t.includes(${literal})))`,
      returnByValue: true
    });
    value = evaluated?.result?.value;
  } catch {
    return [];
  }
  if (typeof value !== "string") return [];
  let texts: unknown;
  try {
    texts = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(texts)) return [];
  const out: ParsedJsonResponse[] = [];
  for (const text of texts) {
    if (typeof text !== "string") continue;
    try {
      out.push({ responseUrl: sourceUrl, body: JSON.parse(text), bodySize: Buffer.byteLength(text, "utf8") });
    } catch {
      // Skip blobs that are not valid JSON.
    }
  }
  return out;
}

function getInstagramNavigateUrl(input: InstagramCdpCaptureInput): string | undefined {
  if (input.url?.trim()) {
    const url = new URL(input.url.trim());
    if (url.hostname !== "instagram.com" && !url.hostname.endsWith(".instagram.com")) {
      throw new Error("Instagram capture URL must be on instagram.com.");
    }
    return url.toString();
  }

  if (input.username?.trim()) {
    const username = input.username.trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) {
      throw new Error("Instagram username contains unsupported characters.");
    }
    return `https://www.instagram.com/${username}/`;
  }

  return undefined;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}
