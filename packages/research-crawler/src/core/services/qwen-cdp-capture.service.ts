import { connectCdpSession, type CdpSession } from "../chrome/cdp-session.js";
import {
  closeChromeTab,
  normalizeChromeOrigin,
  openChromeTab,
  resolveQwenTarget,
  type ChromeTarget
} from "../chrome/chrome-connector.js";
import { createCdpDebugCollector, type CdpDebugCollector } from "../network/network-listener.js";
import { silentReporter, type ProgressReporter } from "../progress/progress-reporter.js";
import type { ChatGPTMessage } from "../standard-output.js";

/**
 * Qwen (chat.qwen.ai) CDP capture service. Mirrors the ChatGPT service but
 * adapted to Qwen's real, empirically-discovered behavior
 * (see docs/qwen-crawler-cdp.md):
 *
 *  - Auth is cookie-based. `GET /api/v1/auths/` returns 200 when logged in (and
 *    the user object), 401 otherwise. Page-context `fetch(..., {credentials:'include'})`
 *    carries the session, so no bearer token is needed.
 *  - List:   `GET /api/v2/chats/?page=1` -> { success, request_id, data: ChatSummary[] }.
 *  - Detail: `GET /api/v2/chats/{id}`   -> { data: { chat: { history: { messages, currentId } } } }.
 *            Assistant text lives in each node's `content_list[]` blocks whose
 *            `phase === 'answer'` (top-level `content` is empty for assistant turns);
 *            user turns use the plain `content` string.
 *  - Send:   DOM automation. The real POSTs (`/api/v2/chats/new`,
 *            `/api/v2/chat/completions`) carry Alibaba anti-bot headers
 *            (`bx-ua`, `bx-umidtoken`, `bx-v`) computed by the page SDK and are
 *            impractical to forge — so we type into the composer + submit and read
 *            the reply ourselves (DOM stream, then canonical detail fetch).
 */

export type QwenConversationRecord = {
  id: string;
  title: string;
  createTime: any;
  updateTime: any;
};

export type QwenCdpCaptureInput = {
  chromeOrigin?: string;
  url?: string;
  timeoutMs?: number;
  reporter?: ProgressReporter;
  phaseLabel?: string;
  openNewTab?: boolean;
  keepTabOpen?: boolean;
};

export type QwenRawResponseRecord = {
  responseUrl: string;
  statusCode?: number;
  contentType?: string;
  bodySize: number;
  body: unknown;
};

export type QwenCdpCaptureSuccess = {
  ok: true;
  conversations: QwenConversationRecord[];
  rawResponses: QwenRawResponseRecord[];
  debug?: CdpDebugCollector;
  meta: {
    chromeOrigin: string;
    tabUrl: string;
    matchedResponses: number;
    startedAt: string;
    completedAt: string;
  };
};

export type QwenCdpCaptureFailure = {
  ok: false;
  debug?: CdpDebugCollector;
  error: {
    code: "CHROME_CDP_UNAVAILABLE" | "QWEN_TAB_NOT_FOUND" | "QWEN_CDP_CAPTURE_FAILED";
    message: string;
  };
};

export type QwenCdpCaptureResult = QwenCdpCaptureSuccess | QwenCdpCaptureFailure;

export type QwenCdpCaptureDetailsInput = {
  chromeOrigin?: string;
  conversationId: string;
  timeoutMs?: number;
  reporter?: ProgressReporter;
  phaseLabel?: string;
  openNewTab?: boolean;
  keepTabOpen?: boolean;
};

export type QwenCdpCaptureDetailsSuccess = {
  ok: true;
  messages: ChatGPTMessage[];
  rawResponses: QwenRawResponseRecord[];
  debug?: CdpDebugCollector;
  meta: {
    chromeOrigin: string;
    tabUrl: string;
    matchedResponses: number;
    startedAt: string;
    completedAt: string;
  };
};

export type QwenCdpCaptureDetailsResult = QwenCdpCaptureDetailsSuccess | QwenCdpCaptureFailure;

export type QwenCdpPromptInput = {
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
  signal?: AbortSignal;
};

export type QwenCdpPromptSuccess = {
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

export type QwenCdpPromptResult = QwenCdpPromptSuccess | QwenCdpCaptureFailure;

export type QwenCdpCaptureService = {
  capture(input: QwenCdpCaptureInput): Promise<QwenCdpCaptureResult>;
  captureDetails(input: QwenCdpCaptureDetailsInput): Promise<QwenCdpCaptureDetailsResult>;
  sendPrompt(input: QwenCdpPromptInput): Promise<QwenCdpPromptResult>;
};

export type QwenCdpCaptureServiceOptions = {
  fetchImpl?: typeof fetch;
  connectSession?: (webSocketDebuggerUrl: string) => Promise<CdpSession>;
};

const QWEN_BASE = "https://chat.qwen.ai/";
const LIST_PATH = "/api/v2/chats/?page=1";
const detailPath = (id: string) => `/api/v2/chats/${id}`;

export function createQwenCdpCaptureService(
  options: QwenCdpCaptureServiceOptions = {}
): QwenCdpCaptureService {
  return {
    async capture(input) {
      const startedAt = new Date().toISOString();
      const debug = createCdpDebugCollector();
      const ctx = await openSession(input, QWEN_BASE, options, debug);
      if (!ctx.ok) return ctx.failure;
      const { session, chromeOrigin, navigateUrl, openedTabId } = ctx;
      const reporter: ProgressReporter = input.reporter ?? silentReporter();
      const phase = input.phaseLabel ?? "qwen:conversations";

      try {
        reporter.start(phase, 1);
        await ensureQwenPageReady(session, navigateUrl, debug);

        if (!(await checkQwenLoggedIn(session))) {
          return notLoggedIn(debug);
        }

        const fetched = await fetchQwenJsonViaPage(session, LIST_PATH);
        recordResponse(debug, QWEN_BASE.replace(/\/$/, "") + LIST_PATH, fetched);
        reporter.done(phase);

        if (fetched.status !== 200 || !fetched.body) {
          return capFailure(debug, `Qwen conversation list fetch failed (status ${fetched.status ?? "unknown"}).`);
        }

        let body: any;
        try { body = JSON.parse(fetched.body); } catch {
          return capFailure(debug, "Qwen conversation list response was not valid JSON.");
        }

        const items: any[] = Array.isArray(body?.data)
          ? body.data
          : Array.isArray(body?.data?.data)
            ? body.data.data
            : Array.isArray(body?.data?.items)
              ? body.data.items
              : [];

        const conversations: QwenConversationRecord[] = [];
        for (const item of items) {
          if (item && item.id) {
            conversations.push({
              id: String(item.id),
              title: item.title ?? "Untitled",
              createTime: item.created_at ?? item.create_time,
              updateTime: item.updated_at ?? item.update_time ?? item.created_at
            });
          }
        }
        debug.events.push(`${new Date().toISOString()} parsed ${conversations.length} conversations`);

        return {
          ok: true,
          conversations,
          debug,
          rawResponses: [{
            responseUrl: QWEN_BASE.replace(/\/$/, "") + LIST_PATH,
            statusCode: fetched.status,
            contentType: "application/json",
            bodySize: Buffer.byteLength(fetched.body, "utf8"),
            body
          }],
          meta: { chromeOrigin, tabUrl: navigateUrl, matchedResponses: 1, startedAt, completedAt: new Date().toISOString() }
        };
      } catch (error) {
        return capFailure(debug, error instanceof Error ? error.message : "Qwen CDP capture failed.");
      } finally {
        session.close();
        if (openedTabId && !input.keepTabOpen) {
          await closeChromeTab({ chromeOrigin, fetchImpl: options.fetchImpl, targetId: openedTabId });
        }
      }
    },

    async captureDetails(input) {
      const startedAt = new Date().toISOString();
      const debug = createCdpDebugCollector();
      const navigateUrl = `${QWEN_BASE}c/${input.conversationId}`;
      const ctx = await openSession(input, navigateUrl, options, debug);
      if (!ctx.ok) return ctx.failure;
      const { session, chromeOrigin, openedTabId } = ctx;
      const reporter: ProgressReporter = input.reporter ?? silentReporter();
      const phase = input.phaseLabel ?? "qwen:details";

      try {
        reporter.start(phase, 1);
        await ensureQwenPageReady(session, navigateUrl, debug);
        reporter.update(phase, 1, "fetching");

        if (!(await checkQwenLoggedIn(session))) {
          return notLoggedIn(debug);
        }

        const path = detailPath(input.conversationId);
        const fetched = await fetchQwenJsonViaPage(session, path);
        recordResponse(debug, QWEN_BASE.replace(/\/$/, "") + path, fetched);
        reporter.done(phase);

        if (fetched.status !== 200 || !fetched.body) {
          return capFailure(debug, `Qwen conversation fetch failed (status ${fetched.status ?? "unknown"}).`);
        }

        let body: unknown;
        try { body = JSON.parse(fetched.body); } catch {
          return capFailure(debug, "Qwen conversation response was not valid JSON.");
        }

        const messages = parseQwenMessageTree(body);
        debug.events.push(`${new Date().toISOString()} parsed ${messages.length} messages`);

        return {
          ok: true,
          messages,
          debug,
          rawResponses: [{
            responseUrl: QWEN_BASE.replace(/\/$/, "") + path,
            statusCode: fetched.status,
            contentType: "application/json",
            bodySize: Buffer.byteLength(fetched.body, "utf8"),
            body
          }],
          meta: { chromeOrigin, tabUrl: navigateUrl, matchedResponses: 1, startedAt, completedAt: new Date().toISOString() }
        };
      } catch (error) {
        return capFailure(debug, error instanceof Error ? error.message : "Qwen CDP capture details failed.");
      } finally {
        session.close();
        if (openedTabId && !input.keepTabOpen) {
          await closeChromeTab({ chromeOrigin, fetchImpl: options.fetchImpl, targetId: openedTabId });
        }
      }
    },

    async sendPrompt(input) {
      const startedAt = new Date().toISOString();
      const debug = createCdpDebugCollector();
      const navigateUrl = input.conversationId ? `${QWEN_BASE}c/${input.conversationId}` : QWEN_BASE;
      const ctx = await openSession(input, navigateUrl, options, debug);
      if (!ctx.ok) return ctx.failure;
      const { session, chromeOrigin, openedTabId } = ctx;
      const reporter: ProgressReporter = input.reporter ?? silentReporter();
      const phase = input.phaseLabel ?? "qwen:send_prompt";

      try {
        if (input.signal) {
          if (input.signal.aborted) throw new Error("Aborted before prompt sent");
          input.signal.addEventListener("abort", () => {
            session.close();
            debug.events.push(`${new Date().toISOString()} CDP session closed due to AbortSignal`);
          }, { once: true });
        }
        reporter.start(phase, 1);

        // 1. Land on the EXACT target page before composing — composing on the wrong
        //    page makes Qwen start a brand-new conversation.
        const expectPath = input.conversationId ? `/c/${input.conversationId}` : undefined;
        await navigateAndWaitForUrl(session, navigateUrl, expectPath, debug);

        if (!(await checkQwenLoggedIn(session))) {
          return notLoggedIn(debug);
        }

        // 2. Wait for the composer.
        const composerSel = `textarea.message-input-textarea, textarea, [contenteditable="true"]`;
        if (!(await waitFor(session, `!!document.querySelector('${composerSel}')`, 20000))) {
          throw new Error("Timeout waiting for Qwen input area to load.");
        }

        // 3. For an existing conversation, wait for prior turns to render, then
        //    snapshot the assistant count + currentId so we recognize the NEW turn.
        let initialAssistantCount = 0;
        let initialCurrentId: string | null = null;
        if (input.conversationId) {
          const renderDeadline = Date.now() + 15000;
          while (Date.now() < renderDeadline) {
            const any = (await evalPageValue<number>(session, `return document.querySelectorAll('.qwen-chat-message').length;`)) ?? 0;
            if (any > 0) break;
            await delay(400);
          }
          await delay(800);
          initialAssistantCount = await assistantCount(session);
          const pre = await fetchQwenJsonViaPage(session, detailPath(input.conversationId));
          initialCurrentId = currentIdOf(pre.body);
        }
        debug.events.push(`${new Date().toISOString()} pre-send assistant turns=${initialAssistantCount}`);

        // Let the SPA finish hydrating so the composer's submit handler is bound —
        // otherwise the first Enter/click is silently dropped.
        await delay(600);

        // 4-6. Compose, submit, and resolve the conversation id. Submission can be
        //    dropped if the composer isn't fully wired yet, so we retry: re-focus,
        //    re-insert the prompt when the composer is empty, submit again, and
        //    confirm by EITHER a fresh `/c/{id}` URL OR generation starting (the
        //    stop button appears / a new assistant turn is appended).
        let resolvedConversationId = input.conversationId ?? "";
        let confirmed = false;
        const overallDeadline = Date.now() + 45000;
        let lastSubmitAt = 0;
        while (Date.now() < overallDeadline) {
          if (Date.now() - lastSubmitAt > 8000) {
            const empty = (await evalPageValue<boolean>(session, `
              const ta = document.querySelector('${composerSel}');
              if (!ta) return true;
              const v = ('value' in ta ? ta.value : ta.innerText) || '';
              return !v.trim();
            `)) ?? true;
            await session.send("Runtime.evaluate", { expression: `document.querySelector('${composerSel}') && document.querySelector('${composerSel}').focus()` });
            if (empty) { await session.send("Input.insertText", { text: input.prompt }); await delay(250); }
            await session.send("Runtime.evaluate", {
              expression: `
                (function() {
                  const ta = document.querySelector('${composerSel}');
                  if (ta) ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
                  const btn = document.querySelector('button[aria-label*="Send" i], button[data-testid*="send" i], button.send-btn, button[class*="send" i]:not([disabled])');
                  if (btn && !btn.disabled) { btn.click(); return "clicked_button"; }
                  return ta ? "dispatched_enter" : "none";
                })()
              `
            });
            lastSubmitAt = Date.now();
            debug.events.push(`${new Date().toISOString()} submit attempt (composer ${empty ? "was empty, re-inserted" : "had text"})`);
          }

          const href = (await evalPageValue<string>(session, `return window.location.href;`)) ?? "";
          const m = href.match(/\/c\/([a-zA-Z0-9-]+)/i);
          if (m && m[1] && m[1] !== "guest" && m[1] !== "new-chat") {
            resolvedConversationId = m[1];
            // A new chat navigating to its id is itself the confirmation.
            confirmed = true;
            break;
          }
          if (input.conversationId) {
            // Existing chat: the URL already has the id, so confirm by generation start.
            const generating = (await evalPageValue<boolean>(session, `return !!document.querySelector('button.stop-button');`)) ?? false;
            const grew = (await assistantCount(session)) > initialAssistantCount;
            if (generating || grew) { confirmed = true; break; }
          }
          await delay(1200);
        }
        if (!resolvedConversationId) throw new Error("Could not resolve conversation ID after sending prompt.");
        if (!confirmed) debug.events.push(`${new Date().toISOString()} submit not explicitly confirmed; proceeding to read`);
        debug.events.push(`${new Date().toISOString()} conversation id ${resolvedConversationId}`);

        // 7. Stream the NEW assistant turn from the DOM. The new turn exists only once
        //    a fresh `.qwen-chat-message-assistant` was appended past the pre-send count.
        //    We read TWO things per poll:
        //      - `answerText`: the `phase-answer` markdown only. This is what we stream
        //        via onDelta — it grows monotonically, so consumers that accumulate
        //        deltas (the ai-agent runner) never get polluted by Qwen's separate
        //        "thinking" text. It can read empty even when the turn is done (the DOM
        //        is inconsistent), in which case the canonical detail fetch (step 8)
        //        supplies the answer.
        //      - `fullText`: the whole assistant element, used ONLY to detect the turn
        //        and its completion (it's non-monotonic, so never streamed).
        //    Completion = `.stop-button` disappears AND `fullText` stops changing.
        const deadline = Date.now() + (input.timeoutMs ?? 180000);
        let lastText = "";
        let lastFullText = "";
        let stableText = 0;
        while (Date.now() < deadline) {
          const snap = (await evalPageValue<{ count: number; answerText: string; fullText: string }>(session, `
            const els = document.querySelectorAll('.qwen-chat-message-assistant');
            const last = els[els.length - 1];
            let fullText = '', answerText = '';
            if (last) {
              fullText = last.innerText || '';
              const ans = last.querySelector('.response-message-content.phase-answer');
              answerText = (ans && ans.innerText) ? ans.innerText : '';
            }
            return { count: els.length, answerText, fullText };
          `)) ?? { count: 0, answerText: "", fullText: "" };
          const generating = (await evalPageValue<boolean>(session, `
            return !!document.querySelector('button.stop-button, button[aria-label*="stop" i], button[aria-label*="pause" i]');
          `)) ?? false;

          const turnPresent = snap.count > initialAssistantCount && snap.fullText.length > 0;
          if (turnPresent && snap.answerText && snap.answerText !== lastText) {
            lastText = snap.answerText;
            input.onDelta?.(snap.answerText);
          }
          if (turnPresent && !generating && snap.fullText === lastFullText) {
            if (++stableText >= 2) break;
          } else {
            stableText = 0;
            lastFullText = snap.fullText;
          }
          await delay(700);
        }
        debug.events.push(`${new Date().toISOString()} streamed ${lastText.length} answer chars from DOM (new turn)`);

        // 8. Fetch the canonical final history from the detail endpoint. `currentId`
        //    lags the DOM (and initially still points at the PREVIOUS turn), so wait
        //    until it advances past the pre-send node before accepting the result.
        let messages: ChatGPTMessage[] = [];
        let lastFetched: PageJsonFetch = {};
        for (let attempt = 0; attempt < 12; attempt++) {
          const f = await fetchQwenJsonViaPage(session, detailPath(resolvedConversationId));
          lastFetched = f;
          if (f.notLoggedIn) return notLoggedIn(debug);
          if (f.status === 200 && f.body) {
            let parsed: unknown = null;
            try { parsed = JSON.parse(f.body); } catch { parsed = null; }
            if (parsed) {
              const currentId = currentIdOf(f.body);
              const msgs = parseQwenMessageTree(parsed);
              const last = msgs[msgs.length - 1];
              const advanced = currentId !== initialCurrentId;
              if (advanced && last && last.role === "assistant" && last.content && last.content.length > 0) {
                messages = msgs;
                break;
              }
            }
          }
          await delay(1000);
        }

        // Fallback: detail never settled but we streamed text — return that.
        if (messages.length === 0 && lastText.length > 0) {
          messages = [{ id: `dom-${resolvedConversationId}`, role: "assistant", content: lastText, createTime: new Date().toISOString() }];
          debug.events.push(`${new Date().toISOString()} detail did not settle; using DOM text fallback`);
        }

        recordResponse(debug, QWEN_BASE.replace(/\/$/, "") + detailPath(resolvedConversationId), lastFetched);
        debug.events.push(`${new Date().toISOString()} settled with ${messages.length} messages`);

        if (messages.length === 0) {
          return capFailure(debug, "Timed out waiting for the assistant response after sending the prompt.");
        }
        reporter.done(phase);

        return {
          ok: true,
          conversationId: resolvedConversationId,
          messages,
          debug,
          meta: { chromeOrigin, tabUrl: `${QWEN_BASE}c/${resolvedConversationId}`, startedAt, completedAt: new Date().toISOString() }
        };
      } catch (error) {
        return capFailure(debug, error instanceof Error ? error.message : "Qwen CDP prompt failed.");
      } finally {
        session.close();
        if (openedTabId && !input.keepTabOpen) {
          await closeChromeTab({ chromeOrigin, fetchImpl: options.fetchImpl, targetId: openedTabId });
        }
      }
    }
  };
}

/* ------------------------------------------------------------------ helpers */

type OpenSessionOk = {
  ok: true;
  session: CdpSession;
  chromeOrigin: string;
  navigateUrl: string;
  openedTabId?: string;
};
type OpenSessionErr = { ok: false; failure: QwenCdpCaptureFailure };

/** Resolve a Chrome target (reuse or open a tab), connect a CDP session. */
async function openSession(
  input: { chromeOrigin?: string; openNewTab?: boolean; keepTabOpen?: boolean },
  navigateUrl: string,
  options: QwenCdpCaptureServiceOptions,
  debug: CdpDebugCollector
): Promise<OpenSessionOk | OpenSessionErr> {
  let chromeOrigin: string;
  try {
    chromeOrigin = normalizeChromeOrigin(input.chromeOrigin);
  } catch (error) {
    return { ok: false, failure: { ok: false, debug, error: { code: "QWEN_CDP_CAPTURE_FAILED", message: error instanceof Error ? error.message : "Qwen CDP input is invalid." } } };
  }

  let target: ChromeTarget;
  let openedTabId: string | undefined;
  debug.events.push(`${new Date().toISOString()} target: ${input.openNewTab ? "opening new tab" : "reusing tab"} at ${navigateUrl}`);
  try {
    if (input.openNewTab) {
      target = await openChromeTab({ chromeOrigin, fetchImpl: options.fetchImpl, url: navigateUrl });
      openedTabId = target.id;
    } else {
      target = await resolveQwenTarget({ chromeOrigin, fetchImpl: options.fetchImpl, allowAnyPage: true });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, failure: { ok: false, debug, error: { code: "QWEN_TAB_NOT_FOUND", message: input.openNewTab ? `Failed to open new Chrome tab at ${chromeOrigin}: ${detail}` : `Browser data connection is not reachable at ${chromeOrigin}: ${detail}` } } };
  }

  if (!target.webSocketDebuggerUrl) {
    if (openedTabId) await closeChromeTab({ chromeOrigin, fetchImpl: options.fetchImpl, targetId: openedTabId });
    return { ok: false, failure: { ok: false, debug, error: { code: "QWEN_TAB_NOT_FOUND", message: "Open chat.qwen.ai in the browser started from Browser Intelligence." } } };
  }

  const session = await (options.connectSession ?? connectCdpSession)(target.webSocketDebuggerUrl);
  debug.events.push(`${new Date().toISOString()} CDP session connected to ${target.id}`);
  return { ok: true, session, chromeOrigin, navigateUrl, openedTabId };
}

function capFailure(debug: CdpDebugCollector, message: string): QwenCdpCaptureFailure {
  return { ok: false, debug, error: { code: "QWEN_CDP_CAPTURE_FAILED", message } };
}

function notLoggedIn(debug: CdpDebugCollector): QwenCdpCaptureFailure {
  debug.events.push(`${new Date().toISOString()} NOT_LOGGED_IN`);
  return { ok: false, debug, error: { code: "QWEN_CDP_CAPTURE_FAILED", message: "Not logged in to Qwen. Open the login profile, sign in at chat.qwen.ai, then retry." } };
}

function recordResponse(debug: CdpDebugCollector, url: string, fetched: PageJsonFetch): void {
  debug.responses.push({
    url,
    status: fetched.status,
    contentType: "application/json",
    matched: true,
    bodySize: fetched.body ? Buffer.byteLength(fetched.body, "utf8") : undefined,
    bodyOk: !!fetched.body
  });
  debug.events.push(`${new Date().toISOString()} fetch ${url} -> ${fetched.notLoggedIn ? "NOT_LOGGED_IN" : `status ${fetched.status}, ${fetched.body?.length ?? 0} bytes`}`);
}

async function assistantCount(session: CdpSession): Promise<number> {
  return (await evalPageValue<number>(session, `return document.querySelectorAll('.qwen-chat-message-assistant').length;`)) ?? 0;
}

function currentIdOf(bodyText: string | undefined): string | null {
  if (!bodyText) return null;
  try {
    const j = JSON.parse(bodyText);
    const data = j?.data ?? j;
    const chat = data?.chat ?? data;
    return chat?.history?.currentId ?? null;
  } catch {
    return null;
  }
}

/** Parse Qwen's `history.messages` map (currentId + parentId chain) into ordered messages. */
function parseQwenMessageTree(body: any): ChatGPTMessage[] {
  const messages: ChatGPTMessage[] = [];
  const data = body?.data ?? body;
  const chat = data?.chat ?? data;
  const history = chat?.history;
  if (!history || typeof history !== "object" || !history.messages) return messages;

  const mapping = history.messages as Record<string, any>;
  let currentId: string | undefined = history.currentId;

  if (!currentId) {
    // No currentId: pick the latest-timestamp leaf (a node nobody points to as parent).
    const parentIds = new Set(Object.values(mapping).map((n: any) => n?.parentId).filter(Boolean));
    const leaves = Object.keys(mapping).filter((id) => !parentIds.has(id));
    let latest = -1;
    for (const id of leaves) {
      const ts = Number(mapping[id]?.timestamp ?? 0);
      if (ts >= latest) { latest = ts; currentId = id; }
    }
    if (!currentId && leaves.length > 0) currentId = leaves[leaves.length - 1];
  }

  // Trace back via parentId.
  const path: any[] = [];
  let id: string | undefined = currentId;
  const visited = new Set<string>();
  while (id && !visited.has(id)) {
    visited.add(id);
    const node = mapping[id];
    if (!node) break;
    path.push(node);
    id = node.parentId;
  }
  path.reverse();

  for (const node of path) {
    const role = node?.role;
    if (!role || role === "system") continue;
    const text = extractQwenText(node);
    if (text) {
      messages.push({
        id: String(node.id ?? `${role}-${node.timestamp ?? messages.length}`),
        role,
        content: text,
        createTime: parseSafeDate(node.timestamp)
      });
    }
  }

  return messages;
}

/**
 * Qwen stores assistant text in `content_list[]` blocks (the `phase === 'answer'`
 * blocks hold the reply; `thinking_summary` holds reasoning). User turns use the
 * plain `content` string.
 */
function extractQwenText(node: any): string {
  if (typeof node?.content === "string" && node.content.trim() !== "") return node.content;
  if (Array.isArray(node?.content_list)) {
    const answer = node.content_list
      .filter((b: any) => b?.phase === "answer" && typeof b?.content === "string")
      .map((b: any) => b.content)
      .join("");
    if (answer.trim() !== "") return answer;
    // Fallback: any non-empty block content.
    return node.content_list
      .filter((b: any) => typeof b?.content === "string" && b.content.trim() !== "")
      .map((b: any) => b.content)
      .join("");
  }
  return "";
}

function parseSafeDate(val: any): string {
  if (!val) return new Date().toISOString();
  if (typeof val === "number") {
    const isSeconds = val < 10000000000;
    const date = new Date(isSeconds ? val * 1000 : val);
    return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }
  if (typeof val === "string") {
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

async function waitFor(session: CdpSession, booleanExpr: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const check = await session.send<{ result?: { value?: boolean } }>("Runtime.evaluate", { expression: booleanExpr });
    if (check?.result?.value) return true;
    await delay(500);
  }
  return false;
}

/** True when `GET /api/v1/auths/` returns 200 (a logged-in Qwen session). */
async function checkQwenLoggedIn(session: CdpSession): Promise<boolean> {
  const status = await evalPageValue<number>(session, `
    try { const r = await fetch('/api/v1/auths/', { credentials: 'include' }); return r.status; } catch { return 0; }
  `);
  return status === 200;
}

async function ensureQwenPageReady(session: CdpSession, url: string, debug: CdpDebugCollector): Promise<void> {
  try { await session.send("Page.enable"); } catch {}
  const info = await evalPageValue<{ href?: string; ready?: string }>(session, `return { href: location.href, ready: document.readyState };`);
  const onQwen = typeof info?.href === "string" && info.href.includes("qwen.ai");
  if (!onQwen) {
    debug.events.push(`${new Date().toISOString()} navigating to ${url} (was ${info?.href ?? "unknown"})`);
    await session.send("Page.navigate", { url });
  }
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const r = await evalPageValue<{ href?: string; ready?: string }>(session, `return { href: location.href, ready: document.readyState };`);
    if (typeof r?.href === "string" && r.href.includes("qwen.ai") && r.ready && r.ready !== "loading") return;
    await delay(400);
  }
}

async function navigateAndWaitForUrl(session: CdpSession, url: string, expectPath: string | undefined, debug: CdpDebugCollector): Promise<void> {
  try { await session.send("Page.enable"); } catch {}
  debug.events.push(`${new Date().toISOString()} navigating to ${url}${expectPath ? ` (expect ${expectPath})` : ""}`);
  await session.send("Page.navigate", { url });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const r = await evalPageValue<{ href?: string; ready?: string }>(session, `return { href: location.href, ready: document.readyState };`);
    const href = r?.href ?? "";
    const ready = r?.ready;
    const locationOk = expectPath ? href.includes(expectPath) : href.includes("qwen.ai");
    if (locationOk && ready && ready !== "loading") {
      debug.events.push(`${new Date().toISOString()} landed on ${href}`);
      return;
    }
    await delay(400);
  }
  debug.events.push(`${new Date().toISOString()} navigate wait timed out (expect ${expectPath ?? "qwen.ai"})`);
}

type PageJsonFetch = { status?: number; body?: string; notLoggedIn?: boolean };

/** Fetch JSON from the page context using the logged-in cookie session. */
async function fetchQwenJsonViaPage(session: CdpSession, path: string): Promise<PageJsonFetch> {
  const p = JSON.stringify(path);
  const value = await evalPageValue<PageJsonFetch>(session, `
    const r = await fetch(${p}, { credentials: 'include' });
    if (r.status === 401) return { status: 401, notLoggedIn: true };
    const body = await r.text();
    return { status: r.status, body };
  `);
  return value ?? {};
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
