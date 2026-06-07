import { connectCdpSession, type CdpSession } from "../chrome/cdp-session.js";
import {
  closeChromeTab,
  normalizeChromeOrigin,
  openChromeTab,
  resolveChatGPTTarget,
  type ChromeTarget
} from "../chrome/chrome-connector.js";
import { captureChatGPTNetworkResponses, createCdpDebugCollector, type CdpDebugCollector } from "../network/network-listener.js";
import { silentReporter, type ProgressReporter } from "../progress/progress-reporter.js";
import type { ChatGPTMessage } from "../standard-output.js";

export type ChatGPTConversationRecord = {
  id: string;
  title: string;
  createTime: any;
  updateTime: any;
};

export type ChatGPTCdpCaptureInput = {
  chromeOrigin?: string;
  url?: string;
  timeoutMs?: number;
  reporter?: ProgressReporter;
  phaseLabel?: string;
  openNewTab?: boolean;
  keepTabOpen?: boolean;
  initialDelayMs?: number;
  scrollIntervalMs?: number;
};

export type ChatGPTCdpCaptureSuccess = {
  ok: true;
  conversations: ChatGPTConversationRecord[];
  rawResponses: ChatGPTRawResponseRecord[];
  debug?: CdpDebugCollector;
  meta: {
    chromeOrigin: string;
    tabUrl: string;
    matchedResponses: number;
    startedAt: string;
    completedAt: string;
  };
};

export type ChatGPTRawResponseRecord = {
  responseUrl: string;
  statusCode?: number;
  contentType?: string;
  bodySize: number;
  body: unknown;
};

export type ChatGPTCdpCaptureFailure = {
  ok: false;
  debug?: CdpDebugCollector;
  error: {
    code: "CHROME_CDP_UNAVAILABLE" | "CHATGPT_TAB_NOT_FOUND" | "CHATGPT_CDP_CAPTURE_FAILED";
    message: string;
  };
};

export type ChatGPTCdpCaptureResult = ChatGPTCdpCaptureSuccess | ChatGPTCdpCaptureFailure;

export type ChatGPTCdpCaptureDetailsInput = {
  chromeOrigin?: string;
  conversationId: string;
  timeoutMs?: number;
  reporter?: ProgressReporter;
  phaseLabel?: string;
  openNewTab?: boolean;
  keepTabOpen?: boolean;
};

export type ChatGPTCdpCaptureDetailsSuccess = {
  ok: true;
  messages: ChatGPTMessage[];
  rawResponses: ChatGPTRawResponseRecord[];
  debug?: CdpDebugCollector;
  meta: {
    chromeOrigin: string;
    tabUrl: string;
    matchedResponses: number;
    startedAt: string;
    completedAt: string;
  };
};

export type ChatGPTCdpCaptureDetailsResult = ChatGPTCdpCaptureDetailsSuccess | ChatGPTCdpCaptureFailure;

export type ChatGPTCdpPromptInput = {
  chromeOrigin?: string;
  prompt: string;
  conversationId?: string;
  timeoutMs?: number;
  reporter?: ProgressReporter;
  phaseLabel?: string;
  openNewTab?: boolean;
  keepTabOpen?: boolean;
  /** Called with the full assistant text so far as it streams in from the page. */
  onDelta?: (text: string) => void;
};

export type ChatGPTCdpPromptSuccess = {
  ok: true;
  conversationId: string;
  messages: ChatGPTMessage[];
  debug?: CdpDebugCollector;
  meta: {
    chromeOrigin: string;
    tabUrl: string;
    startedAt: string;
    completedAt: string;
  };
};

export type ChatGPTCdpPromptResult = ChatGPTCdpPromptSuccess | ChatGPTCdpCaptureFailure;

export type ChatGPTCdpCaptureService = {
  capture(input: ChatGPTCdpCaptureInput): Promise<ChatGPTCdpCaptureResult>;
  captureDetails(input: ChatGPTCdpCaptureDetailsInput): Promise<ChatGPTCdpCaptureDetailsResult>;
  sendPrompt(input: ChatGPTCdpPromptInput): Promise<ChatGPTCdpPromptResult>;
};

export type ChatGPTCdpCaptureServiceOptions = {
  fetchImpl?: typeof fetch;
  connectSession?: (webSocketDebuggerUrl: string) => Promise<CdpSession>;
};

export function createChatGPTCdpCaptureService(
  options: ChatGPTCdpCaptureServiceOptions = {}
): ChatGPTCdpCaptureService {
  return {
    async capture(input) {
      const startedAt = new Date().toISOString();
      const debug = createCdpDebugCollector();
      let chromeOrigin: string;
      let navigateUrl: string;
      let target: ChromeTarget;
      let session: CdpSession | null = null;
      let openedTabId: string | undefined;

      try {
        chromeOrigin = normalizeChromeOrigin(input.chromeOrigin);
        navigateUrl = input.url?.trim() || "https://chatgpt.com/";
      } catch (error) {
        return {
          ok: false,
          debug,
          error: {
            code: "CHATGPT_CDP_CAPTURE_FAILED",
            message: error instanceof Error ? error.message : "ChatGPT CDP capture input is invalid."
          }
        };
      }

      debug.events.push(`${new Date().toISOString()} target: ${input.openNewTab ? "opening new tab" : "reusing tab"} at ${navigateUrl}`);
      try {
        if (input.openNewTab) {
          target = await openChromeTab({ chromeOrigin, fetchImpl: options.fetchImpl, url: navigateUrl });
          openedTabId = target.id;
        } else {
          target = await resolveChatGPTTarget({ chromeOrigin, fetchImpl: options.fetchImpl, allowAnyPage: true });
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          debug,
          error: {
            code: "CHATGPT_TAB_NOT_FOUND",
            message: input.openNewTab
              ? `Failed to open new Chrome tab at ${chromeOrigin}: ${detail}`
              : `Browser data connection is not reachable at ${chromeOrigin}: ${detail}`
          }
        };
      }

      if (!target.webSocketDebuggerUrl) {
        if (openedTabId) await closeChromeTab({ chromeOrigin, fetchImpl: options.fetchImpl, targetId: openedTabId });
        return {
          ok: false,
          debug,
          error: {
            code: "CHATGPT_TAB_NOT_FOUND",
            message: "Open ChatGPT in the browser started from Browser Intelligence."
          }
        };
      }

      const reporter: ProgressReporter = input.reporter ?? silentReporter();
      const phase = input.phaseLabel ?? "chatgpt:conversations";
      try {
        session = await (options.connectSession ?? connectCdpSession)(target.webSocketDebuggerUrl);
        debug.events.push(`${new Date().toISOString()} CDP session connected to ${target.id}`);
        reporter.start(phase, 1);

        const captured = await captureChatGPTNetworkResponses(session, {
          timeoutMs: input.timeoutMs ?? 15000,
          maxResponses: 10,
          debug,
          ...(openedTabId ? {} : { navigateUrl }),
          ...(input.scrollIntervalMs ? { scrollIntervalMs: input.scrollIntervalMs } : {}),
          ...(input.initialDelayMs !== undefined ? { initialDelayMs: input.initialDelayMs } : {}),
          onCaptured: (capturedList) => {
            reporter.update(phase, capturedList.length, 'responses');
          },
          shouldStop: (capturedList) => {
            const found = capturedList.some((item) => item.responseUrl.includes("/backend-api/conversations"));
            if (found) {
              reporter.update(phase, 1, 'conversations');
            }
            return found;
          }
        });

        reporter.done(phase);

        const parsedResponses = parseJsonResponses(captured);
        const conversations: ChatGPTConversationRecord[] = [];

        for (const resp of parsedResponses) {
          if (resp.responseUrl.includes("/backend-api/conversations")) {
            const body = resp.body as { items?: Array<{ id: string; title: string; create_time?: any; update_time?: any }> };
            if (body && Array.isArray(body.items)) {
              for (const item of body.items) {
                if (item.id && item.title) {
                  conversations.push({
                    id: item.id,
                    title: item.title,
                    createTime: item.create_time,
                    updateTime: item.update_time
                  });
                }
              }
            }
          }
        }

        return {
          ok: true,
          conversations,
          debug,
          rawResponses: parsedResponses.map((response) => ({
            responseUrl: response.responseUrl,
            statusCode: response.statusCode,
            contentType: response.contentType,
            bodySize: response.bodySize,
            body: response.body
          })),
          meta: {
            chromeOrigin,
            tabUrl: navigateUrl,
            matchedResponses: captured.length,
            startedAt,
            completedAt: new Date().toISOString()
          }
        };
      } catch (error) {
        return {
          ok: false,
          debug,
          error: {
            code: "CHATGPT_CDP_CAPTURE_FAILED",
            message: error instanceof Error ? error.message : "ChatGPT CDP capture failed."
          }
        };
      } finally {
        session?.close();
        if (openedTabId && !input.keepTabOpen) {
          await closeChromeTab({ chromeOrigin, fetchImpl: options.fetchImpl, targetId: openedTabId });
        }
      }
    },

    async captureDetails(input) {
      const startedAt = new Date().toISOString();
      const debug = createCdpDebugCollector();
      let chromeOrigin: string;
      let navigateUrl: string;
      let target: ChromeTarget;
      let session: CdpSession | null = null;
      let openedTabId: string | undefined;

      try {
        chromeOrigin = normalizeChromeOrigin(input.chromeOrigin);
        navigateUrl = `https://chatgpt.com/c/${input.conversationId}`;
      } catch (error) {
        return {
          ok: false,
          debug,
          error: {
            code: "CHATGPT_CDP_CAPTURE_FAILED",
            message: error instanceof Error ? error.message : "ChatGPT CDP capture input is invalid."
          }
        };
      }

      debug.events.push(`${new Date().toISOString()} target: ${input.openNewTab ? "opening new tab" : "reusing tab"} at ${navigateUrl}`);
      try {
        if (input.openNewTab) {
          target = await openChromeTab({ chromeOrigin, fetchImpl: options.fetchImpl, url: navigateUrl });
          openedTabId = target.id;
        } else {
          target = await resolveChatGPTTarget({ chromeOrigin, fetchImpl: options.fetchImpl, allowAnyPage: true });
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          debug,
          error: {
            code: "CHATGPT_TAB_NOT_FOUND",
            message: input.openNewTab
              ? `Failed to open new Chrome tab at ${chromeOrigin}: ${detail}`
              : `Browser data connection is not reachable at ${chromeOrigin}: ${detail}`
          }
        };
      }

      if (!target.webSocketDebuggerUrl) {
        if (openedTabId) await closeChromeTab({ chromeOrigin, fetchImpl: options.fetchImpl, targetId: openedTabId });
        return {
          ok: false,
          debug,
          error: {
            code: "CHATGPT_TAB_NOT_FOUND",
            message: "Open ChatGPT in the browser started from Browser Intelligence."
          }
        };
      }

      const reporter: ProgressReporter = input.reporter ?? silentReporter();
      const phase = input.phaseLabel ?? "chatgpt:details";
      try {
        session = await (options.connectSession ?? connectCdpSession)(target.webSocketDebuggerUrl);
        debug.events.push(`${new Date().toISOString()} CDP session connected to ${target.id}`);
        reporter.start(phase, 1);

        // The conversation detail is fetched directly from the page context using
        // the logged-in session's access token. This is reliable (no network-sniff
        // race, no service-worker issues) and returns the same JSON the app uses.
        await ensureChatGPTPageReady(session, navigateUrl, debug);
        reporter.update(phase, 1, 'fetching');

        const fetched = await fetchConversationDetailViaPage(session, input.conversationId);
        const detailUrl = `https://chatgpt.com/backend-api/conversation/${input.conversationId}`;
        debug.responses.push({
          url: detailUrl,
          status: fetched.status,
          contentType: 'application/json',
          matched: true,
          bodySize: fetched.body ? Buffer.byteLength(fetched.body, 'utf8') : undefined,
          bodyOk: !!fetched.body
        });
        debug.events.push(`${new Date().toISOString()} fetch detail -> ${fetched.notLoggedIn ? 'NOT_LOGGED_IN' : `status ${fetched.status}, ${fetched.body?.length ?? 0} bytes`}`);
        reporter.done(phase);

        if (fetched.notLoggedIn) {
          return {
            ok: false,
            debug,
            error: { code: "CHATGPT_CDP_CAPTURE_FAILED", message: "Not logged in to ChatGPT. Open the login profile, sign in, then retry." }
          };
        }
        if (fetched.status !== 200 || !fetched.body) {
          return {
            ok: false,
            debug,
            error: { code: "CHATGPT_CDP_CAPTURE_FAILED", message: `ChatGPT conversation fetch failed (status ${fetched.status ?? 'unknown'}).` }
          };
        }

        let body: unknown;
        try {
          body = JSON.parse(fetched.body);
        } catch {
          return {
            ok: false,
            debug,
            error: { code: "CHATGPT_CDP_CAPTURE_FAILED", message: "ChatGPT conversation response was not valid JSON." }
          };
        }

        const messages = parseChatGPTMessageTree(body);
        debug.events.push(`${new Date().toISOString()} parsed ${messages.length} messages`);

        return {
          ok: true,
          messages,
          debug,
          rawResponses: [{
            responseUrl: detailUrl,
            statusCode: fetched.status,
            contentType: 'application/json',
            bodySize: Buffer.byteLength(fetched.body, 'utf8'),
            body
          }],
          meta: {
            chromeOrigin,
            tabUrl: navigateUrl,
            matchedResponses: 1,
            startedAt,
            completedAt: new Date().toISOString()
          }
        };
      } catch (error) {
        return {
          ok: false,
          debug,
          error: {
            code: "CHATGPT_CDP_CAPTURE_FAILED",
            message: error instanceof Error ? error.message : "ChatGPT CDP capture details failed."
          }
        };
      } finally {
        session?.close();
        if (openedTabId && !input.keepTabOpen) {
          await closeChromeTab({ chromeOrigin, fetchImpl: options.fetchImpl, targetId: openedTabId });
        }
      }
    },

    async sendPrompt(input) {
      const startedAt = new Date().toISOString();
      const debug = createCdpDebugCollector();
      let chromeOrigin: string;
      let navigateUrl: string;
      let target: ChromeTarget;
      let session: CdpSession | null = null;
      let openedTabId: string | undefined;

      try {
        chromeOrigin = normalizeChromeOrigin(input.chromeOrigin);
        navigateUrl = input.conversationId
          ? `https://chatgpt.com/c/${input.conversationId}`
          : "https://chatgpt.com/";
      } catch (error) {
        return {
          ok: false,
          debug,
          error: {
            code: "CHATGPT_CDP_CAPTURE_FAILED",
            message: error instanceof Error ? error.message : "ChatGPT CDP prompt input is invalid."
          }
        };
      }

      debug.events.push(`${new Date().toISOString()} target: ${input.openNewTab ? "opening new tab" : "reusing tab"} at ${navigateUrl}`);
      try {
        if (input.openNewTab) {
          target = await openChromeTab({ chromeOrigin, fetchImpl: options.fetchImpl, url: navigateUrl });
          openedTabId = target.id;
        } else {
          target = await resolveChatGPTTarget({ chromeOrigin, fetchImpl: options.fetchImpl, allowAnyPage: true });
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          debug,
          error: {
            code: "CHATGPT_TAB_NOT_FOUND",
            message: input.openNewTab
              ? `Failed to open new Chrome tab at ${chromeOrigin}: ${detail}`
              : `Browser data connection is not reachable at ${chromeOrigin}: ${detail}`
          }
        };
      }

      if (!target.webSocketDebuggerUrl) {
        if (openedTabId) await closeChromeTab({ chromeOrigin, fetchImpl: options.fetchImpl, targetId: openedTabId });
        return {
          ok: false,
          debug,
          error: {
            code: "CHATGPT_TAB_NOT_FOUND",
            message: "Open ChatGPT in the browser started from Browser Intelligence."
          }
        };
      }

      const reporter: ProgressReporter = input.reporter ?? silentReporter();
      const phase = input.phaseLabel ?? "chatgpt:send_prompt";
      try {
        session = await (options.connectSession ?? connectCdpSession)(target.webSocketDebuggerUrl);
        debug.events.push(`${new Date().toISOString()} CDP session connected to ${target.id}`);
        reporter.start(phase, 1);

        // 1. Navigate to the EXACT target page before composing. For an existing
        //    conversation we must land on /c/{id}, otherwise composing on the home
        //    page (or a different conversation) starts a brand-new conversation.
        const expectPath = input.conversationId ? `/c/${input.conversationId}` : undefined;
        await navigateAndWaitForUrl(session, navigateUrl, expectPath, debug);

        const checkSelector = `!!document.querySelector('#prompt-textarea, [contenteditable="true"], textarea')`;
        let elementFound = false;
        const start = Date.now();
        while (Date.now() - start < 20000) {
          const check = await session.send<{ result?: { value?: boolean } }>("Runtime.evaluate", { expression: checkSelector });
          if (check?.result?.value) {
            elementFound = true;
            break;
          }
          await delay(500);
        }
        if (!elementFound) {
          throw new Error("Timeout waiting for ChatGPT input area to load.");
        }

        // 2. For an existing conversation, wait for its prior messages to render
        //    (they load ~2-3s after navigation), then snapshot how many assistant
        //    turns exist so we can recognize the NEW turn by a count increase.
        //    Also snapshot current_node so step 7 knows when the new turn persists.
        let initialAssistantCount = 0;
        let initialCurrentNode: string | null = null;
        if (input.conversationId) {
          const renderDeadline = Date.now() + 15000;
          while (Date.now() < renderDeadline) {
            const any = (await evalPageValue<number>(session, `return document.querySelectorAll('[data-message-author-role]').length;`)) ?? 0;
            if (any > 0) break;
            await delay(400);
          }
          await delay(800); // settle so all prior turns are present
          initialAssistantCount = (await evalPageValue<number>(session, `return document.querySelectorAll('[data-message-author-role="assistant"]').length;`)) ?? 0;
          const pre = await fetchConversationDetailViaPage(session, input.conversationId);
          if (pre.status === 200 && pre.body) {
            try { initialCurrentNode = (JSON.parse(pre.body) as { current_node?: string }).current_node ?? null; } catch { /* ignore */ }
          }
        }
        debug.events.push(`${new Date().toISOString()} pre-send assistant turns=${initialAssistantCount}`);

        // 3. Focus the composer and insert the prompt text.
        await session.send("Runtime.evaluate", {
          expression: `document.querySelector('#prompt-textarea, [contenteditable="true"], textarea').focus()`
        });
        await session.send("Input.insertText", { text: input.prompt });
        await delay(300);
        debug.events.push(`${new Date().toISOString()} composed prompt (${input.prompt.length} chars)`);

        // 4. Submit (click the send button, fall back to Enter).
        await session.send("Runtime.evaluate", {
          expression: `
            (function() {
              const btn = document.querySelector('button[data-testid="send-button"], button[aria-label="Send message"], button[data-testid*="send"]');
              if (btn) { btn.click(); return "clicked_button"; }
              const ta = document.querySelector('#prompt-textarea, [contenteditable="true"], textarea');
              if (ta) {
                ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
                return "dispatched_enter";
              }
              return "none";
            })()
          `
        });
        debug.events.push(`${new Date().toISOString()} submitted prompt`);

        // 5. Resolve the conversation id. For a new chat the URL changes to /c/{id}
        //    once the server creates the conversation; for an existing chat we keep
        //    the provided id.
        let resolvedConversationId = input.conversationId ?? "";
        const idDeadline = Date.now() + 30000;
        while (Date.now() < idDeadline) {
          const urlCheck = await session.send<{ result?: { value?: string } }>("Runtime.evaluate", { expression: "window.location.href" });
          const m = String(urlCheck?.result?.value || "").match(/\/c\/([a-zA-Z0-9-]+)/i);
          if (m) { resolvedConversationId = m[1]; break; }
          if (input.conversationId) break;
          await delay(1000);
        }
        if (!resolvedConversationId) {
          throw new Error("Could not resolve conversation ID after sending prompt.");
        }
        debug.events.push(`${new Date().toISOString()} conversation id ${resolvedConversationId}`);

        // 6. Stream the NEW assistant turn from the DOM. The new turn is the last
        //    assistant element ONLY once the assistant count has grown past the
        //    pre-send snapshot — this reliably ignores the previous answer. The
        //    detail endpoint does not update mid-stream, so we read the DOM live.
        const deadline = Date.now() + (input.timeoutMs ?? 180000);
        let lastText = '';
        let stableText = 0;
        while (Date.now() < deadline) {
          const snap = (await evalPageValue<{ count: number; text: string }>(session, `
            const els = document.querySelectorAll('[data-message-author-role="assistant"]');
            const last = els[els.length - 1];
            return { count: els.length, text: last ? last.innerText : '' };
          `)) ?? { count: 0, text: '' };
          const generating = (await evalPageValue<boolean>(session, `
            return !!document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop generating"], button[data-testid*="stop"]');
          `)) ?? false;

          // The new turn exists only when a fresh assistant element was appended.
          const isNewAnswer = snap.count > initialAssistantCount && snap.text.length > 0;
          if (isNewAnswer && snap.text !== lastText) {
            lastText = snap.text;
            stableText = 0;
            input.onDelta?.(snap.text);
          } else if (isNewAnswer && !generating && snap.text === lastText) {
            if (++stableText >= 2) break;
          }
          await delay(700);
        }
        debug.events.push(`${new Date().toISOString()} streamed ${lastText.length} chars from DOM (new turn)`);

        // 7. Fetch the canonical final history (markdown) from the detail endpoint.
        //    current_node lags the DOM and, for an existing conversation, initially
        //    still points at the PREVIOUS assistant turn — so wait until current_node
        //    advances past the pre-send node before accepting the result.
        let messages: ChatGPTMessage[] = [];
        let lastFetched: PageDetailFetch = {};
        for (let attempt = 0; attempt < 10; attempt++) {
          const f = await fetchConversationDetailViaPage(session, resolvedConversationId);
          lastFetched = f;
          if (f.notLoggedIn) {
            return {
              ok: false,
              debug,
              error: { code: "CHATGPT_CDP_CAPTURE_FAILED", message: "Not logged in to ChatGPT. Open the login profile, sign in, then retry." }
            };
          }
          if (f.status === 200 && f.body) {
            let parsed: unknown = null;
            try { parsed = JSON.parse(f.body); } catch { parsed = null; }
            if (parsed) {
              const currentNode = (parsed as { current_node?: string }).current_node ?? null;
              const msgs = parseChatGPTMessageTree(parsed);
              const last = msgs[msgs.length - 1];
              const advanced = currentNode !== initialCurrentNode; // the new turn was persisted
              if (advanced && last && last.role === "assistant" && last.content && last.content.length > 0) {
                messages = msgs;
                break;
              }
            }
          }
          await delay(1000);
        }

        // Fallback: if the detail endpoint never settled but we streamed text from
        // the DOM, return that so long tasks still yield a result.
        if (messages.length === 0 && lastText.length > 0) {
          messages = [{
            id: `dom-${resolvedConversationId}`,
            role: "assistant",
            content: lastText,
            createTime: new Date().toISOString()
          }];
          debug.events.push(`${new Date().toISOString()} detail did not settle; using DOM text fallback`);
        }

        debug.responses.push({
          url: `https://chatgpt.com/backend-api/conversation/${resolvedConversationId}`,
          status: lastFetched.status,
          contentType: 'application/json',
          matched: true,
          bodySize: lastFetched.body ? Buffer.byteLength(lastFetched.body, 'utf8') : undefined,
          bodyOk: !!lastFetched.body
        });
        debug.events.push(`${new Date().toISOString()} settled with ${messages.length} messages`);

        if (messages.length === 0) {
          return {
            ok: false,
            debug,
            error: { code: "CHATGPT_CDP_CAPTURE_FAILED", message: "Timed out waiting for the assistant response after sending the prompt." }
          };
        }

        reporter.done(phase);

        return {
          ok: true,
          conversationId: resolvedConversationId,
          messages,
          debug,
          meta: {
            chromeOrigin,
            tabUrl: `https://chatgpt.com/c/${resolvedConversationId}`,
            startedAt,
            completedAt: new Date().toISOString()
          }
        };
      } catch (error) {
        return {
          ok: false,
          debug,
          error: {
            code: "CHATGPT_CDP_CAPTURE_FAILED",
            message: error instanceof Error ? error.message : "ChatGPT CDP prompt failed."
          }
        };
      } finally {
        session?.close();
        if (openedTabId && !input.keepTabOpen) {
          await closeChromeTab({ chromeOrigin, fetchImpl: options.fetchImpl, targetId: openedTabId });
        }
      }
    }
  };
}

function parseJsonResponses(responses: Array<{
  responseUrl: string;
  statusCode?: number;
  contentType?: string;
  bodyText: string;
  bodySize: number;
}>): Array<{
  responseUrl: string;
  statusCode?: number;
  contentType?: string;
  bodySize: number;
  body: unknown;
}> {
  const parsed: Array<{
    responseUrl: string;
    statusCode?: number;
    contentType?: string;
    bodySize: number;
    body: unknown;
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
      // ignore non-JSON responses
    }
  }
  return parsed;
}

function parseChatGPTMessageTree(body: any): ChatGPTMessage[] {
  const messages: ChatGPTMessage[] = [];
  if (!body || typeof body !== 'object' || !body.mapping) return messages;

  const mapping = body.mapping;
  let currentNodeId = body.current_node;

  // Find a leaf node if not specified
  if (!currentNodeId) {
    const parentIds = new Set(Object.values(mapping).map((n: any) => n.parent).filter(Boolean));
    const leaves = Object.keys(mapping).filter(id => !parentIds.has(id));
    let latestTime = 0;
    for (const leafId of leaves) {
      const node = mapping[leafId];
      const createTime = node?.message?.create_time;
      if (createTime && createTime > latestTime) {
        latestTime = createTime;
        currentNodeId = leafId;
      }
    }
    if (!currentNodeId && leaves.length > 0) {
      currentNodeId = leaves[leaves.length - 1];
    }
  }

  // Trace back using parent pointers
  const path: any[] = [];
  let currId = currentNodeId;
  const visited = new Set<string>();
  while (currId && !visited.has(currId)) {
    visited.add(currId);
    const node = mapping[currId];
    if (node) {
      if (node.message) {
        path.push(node.message);
      }
      currId = node.parent;
    } else {
      break;
    }
  }

  path.reverse();

  for (const msg of path) {
    const role = msg.role || msg.author?.role;
    if (role && role !== 'system') {
      let text = '';
      if (msg.content) {
        if (Array.isArray(msg.content.parts)) {
          text = msg.content.parts
            .map((part: any) => {
              if (typeof part === 'string') return part;
              if (part && typeof part === 'object') {
                if (typeof part.text === 'string') return part.text;
                if (typeof part.val === 'string') return part.val;
              }
              return '';
            })
            .join('');
        } else if (typeof msg.content.text === 'string') {
          text = msg.content.text;
        } else if (typeof msg.content.body === 'string') {
          text = msg.content.body;
        } else if (typeof msg.content === 'string') {
          text = msg.content;
        }
      }
      if (text) {
        messages.push({
          id: msg.id,
          role,
          content: text,
          createTime: parseSafeDate(msg.create_time)
        });
      }
    }
  }

  // Fallback: if tree traversal resulted in no messages, gather all messages and sort chronologically
  if (messages.length === 0) {
    const allMessages: any[] = [];
    for (const key of Object.keys(mapping)) {
      const node = mapping[key];
      if (node && node.message) {
        allMessages.push(node.message);
      }
    }

    allMessages.sort((a, b) => (a.create_time || 0) - (b.create_time || 0));

    for (const msg of allMessages) {
      const role = msg.role || msg.author?.role;
      if (role && role !== 'system') {
        let text = '';
        if (msg.content) {
          if (Array.isArray(msg.content.parts)) {
            text = msg.content.parts
              .map((part: any) => {
                if (typeof part === 'string') return part;
                if (part && typeof part === 'object') {
                  if (typeof part.text === 'string') return part.text;
                  if (typeof part.val === 'string') return part.val;
                }
                return '';
              })
              .join('');
          } else if (typeof msg.content.text === 'string') {
            text = msg.content.text;
          } else if (typeof msg.content.body === 'string') {
            text = msg.content.body;
          } else if (typeof msg.content === 'string') {
            text = msg.content;
          }
        }
        if (text) {
          messages.push({
            id: msg.id,
            role,
            content: text,
            createTime: parseSafeDate(msg.create_time)
          });
        }
      }
    }
  }

  return messages;
}

function parseSafeDate(val: any): string {
  if (!val) return new Date().toISOString();
  if (typeof val === 'number') {
    const isSeconds = val < 10000000000;
    const date = new Date(isSeconds ? val * 1000 : val);
    return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }
  if (typeof val === 'string') {
    const num = Number(val);
    if (!isNaN(num)) {
      const isSeconds = num < 10000000000;
      const date = new Date(isSeconds ? num * 1000 : num);
      return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
    }
    const date = new Date(val);
    return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }
  return new Date().toISOString();
}

/** Evaluate an async expression in the page and return its (by-value) result. */
async function evalPageValue<T = unknown>(session: CdpSession, asyncBody: string): Promise<T | undefined> {
  const res = await session.send<{ result?: { value?: T } }>("Runtime.evaluate", {
    expression: `(async () => { ${asyncBody} })()`,
    awaitPromise: true,
    returnByValue: true
  });
  return res?.result?.value;
}

/**
 * Ensure the attached tab is on a loaded chatgpt.com page so same-origin fetches
 * (and the access token) are available. Navigates + waits if needed.
 */
async function ensureChatGPTPageReady(session: CdpSession, url: string, debug: CdpDebugCollector): Promise<void> {
  try { await session.send("Page.enable"); } catch {}
  const info = await evalPageValue<{ href?: string; ready?: string }>(session, `return { href: location.href, ready: document.readyState };`);
  const onChatGPT = typeof info?.href === "string" && info.href.includes("chatgpt.com");
  if (!onChatGPT) {
    debug.events.push(`${new Date().toISOString()} navigating to ${url} (was ${info?.href ?? "unknown"})`);
    await session.send("Page.navigate", { url });
  }
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const r = await evalPageValue<{ href?: string; ready?: string }>(session, `return { href: location.href, ready: document.readyState };`);
    if (typeof r?.href === "string" && r.href.includes("chatgpt.com") && r.ready && r.ready !== "loading") return;
    await delay(400);
  }
}

/**
 * Navigate the tab to `url` and wait until the page is loaded AND the location
 * matches `expectPath` (when given). Use this before composing a prompt so we are
 * on the right conversation page; otherwise ChatGPT opens a new conversation.
 */
async function navigateAndWaitForUrl(session: CdpSession, url: string, expectPath: string | undefined, debug: CdpDebugCollector): Promise<void> {
  try { await session.send("Page.enable"); } catch {}
  debug.events.push(`${new Date().toISOString()} navigating to ${url}${expectPath ? ` (expect ${expectPath})` : ''}`);
  await session.send("Page.navigate", { url });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const r = await evalPageValue<{ href?: string; ready?: string }>(session, `return { href: location.href, ready: document.readyState };`);
    const href = r?.href ?? "";
    const ready = r?.ready;
    const locationOk = expectPath ? href.includes(expectPath) : href.includes("chatgpt.com");
    if (locationOk && ready && ready !== "loading") {
      debug.events.push(`${new Date().toISOString()} landed on ${href}`);
      return;
    }
    await delay(400);
  }
  debug.events.push(`${new Date().toISOString()} navigate wait timed out (expect ${expectPath ?? "chatgpt.com"})`);
}

type PageDetailFetch = { status?: number; body?: string; notLoggedIn?: boolean };

/**
 * Fetch a conversation's detail JSON from the page context using the logged-in
 * session's access token (Authorization: Bearer ...). Mirrors how chatgpt.com
 * itself loads `/backend-api/conversation/{id}`.
 */
async function fetchConversationDetailViaPage(session: CdpSession, conversationId: string): Promise<PageDetailFetch> {
  const id = JSON.stringify(conversationId);
  const value = await evalPageValue<PageDetailFetch>(session, `
    const s = await fetch('/api/auth/session', { credentials: 'include' }).then(r => r.json()).catch(() => ({}));
    const token = s && s.accessToken;
    if (!token) return { notLoggedIn: true };
    const r = await fetch('/backend-api/conversation/' + ${id}, { credentials: 'include', headers: { Authorization: 'Bearer ' + token } });
    const body = await r.text();
    return { status: r.status, body };
  `);
  return value ?? {};
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
