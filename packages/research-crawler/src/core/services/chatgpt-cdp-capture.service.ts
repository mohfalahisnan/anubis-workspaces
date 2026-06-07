import { connectCdpSession, type CdpSession } from "../chrome/cdp-session.js";
import {
  closeChromeTab,
  normalizeChromeOrigin,
  openChromeTab,
  resolveChatGPTTarget,
  type ChromeTarget
} from "../chrome/chrome-connector.js";
import { captureChatGPTNetworkResponses } from "../network/network-listener.js";
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
};

export type ChatGPTCdpPromptSuccess = {
  ok: true;
  conversationId: string;
  messages: ChatGPTMessage[];
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
          error: {
            code: "CHATGPT_CDP_CAPTURE_FAILED",
            message: error instanceof Error ? error.message : "ChatGPT CDP capture input is invalid."
          }
        };
      }

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
        reporter.start(phase, 1);

        const captured = await captureChatGPTNetworkResponses(session, {
          timeoutMs: input.timeoutMs ?? 15000,
          maxResponses: 10,
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
          error: {
            code: "CHATGPT_CDP_CAPTURE_FAILED",
            message: error instanceof Error ? error.message : "ChatGPT CDP capture input is invalid."
          }
        };
      }

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
        reporter.start(phase, 1);

        const captured = await captureChatGPTNetworkResponses(session, {
          timeoutMs: input.timeoutMs ?? 20000,
          maxResponses: 10,
          ...(openedTabId ? {} : { navigateUrl }),
          onCaptured: (capturedList) => {
            reporter.update(phase, capturedList.length, 'responses');
          },
          shouldStop: (capturedList) => {
            const targetPath = `/backend-api/conversation/${input.conversationId}`.toLowerCase();
            const found = capturedList.some((item) => item.responseUrl.toLowerCase().includes(targetPath));
            if (found) {
              reporter.update(phase, 1, 'details');
            }
            return found;
          }
        });

        reporter.done(phase);

        const parsedResponses = parseJsonResponses(captured);
        let messages: ChatGPTMessage[] = [];
        let matched = false;

        const targetPath = `/backend-api/conversation/${input.conversationId}`.toLowerCase();
        for (const resp of parsedResponses) {
          if (resp.responseUrl.toLowerCase().includes(targetPath)) {
            messages = parseChatGPTMessageTree(resp.body);
            matched = true;
            break;
          }
        }

        if (!matched) {
          return {
            ok: false,
            error: {
              code: "CHATGPT_CDP_CAPTURE_FAILED",
              message: "Timeout or failed to capture conversation details from network responses. Ensure the browser is logged in and active."
            }
          };
        }

        return {
          ok: true,
          messages,
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
          error: {
            code: "CHATGPT_CDP_CAPTURE_FAILED",
            message: error instanceof Error ? error.message : "ChatGPT CDP prompt input is invalid."
          }
        };
      }

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
        reporter.start(phase, 1);

        // 1. Wait for textarea to load
        await session.send("Page.enable");
        if (!input.openNewTab) {
          await session.send("Page.navigate", { url: navigateUrl });
        }

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

        // 2. Focus input and insert text
        await session.send("Runtime.evaluate", {
          expression: `document.querySelector('#prompt-textarea, [contenteditable="true"], textarea').focus()`
        });
        await session.send("Input.insertText", { text: input.prompt });
        await delay(300);

        // 3. Click send button
        await session.send("Runtime.evaluate", {
          expression: `
            (function() {
              const btn = document.querySelector('button[data-testid="send-button"], button[aria-label="Send message"], button[data-testid*="send"]');
              if (btn) {
                btn.click();
                return "clicked_button";
              }
              const ta = document.querySelector('#prompt-textarea, [contenteditable="true"], textarea');
              if (ta) {
                const e = new KeyboardEvent('keydown', {
                  key: 'Enter',
                  code: 'Enter',
                  keyCode: 13,
                  which: 13,
                  bubbles: true,
                  cancelable: true
                });
                ta.dispatchEvent(e);
                return "dispatched_enter";
              }
              return "none";
            })()
          `
        });

        // 4. Wait for generation to start and finish
        await delay(1500); // Wait 1.5s for streaming to start
        const deadline = Date.now() + (input.timeoutMs ?? 60000);
        let isDone = false;
        while (Date.now() < deadline) {
          const statusCheck = await session.send<{ result?: { value?: string } }>("Runtime.evaluate", {
            expression: `
              (function() {
                const stopBtn = document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop generating"], button[data-testid*="stop"]');
                if (stopBtn) return "streaming";
                
                const sendBtn = document.querySelector('button[data-testid="send-button"], button[aria-label="Send message"], button[data-testid*="send"]');
                if (sendBtn && !sendBtn.disabled) return "idle";
                
                return "loading";
              })()
            `
          });
          const status = statusCheck?.result?.value;
          if (status === "idle") {
            isDone = true;
            break;
          }
          await delay(1000);
        }

        if (!isDone) {
          throw new Error("Timeout waiting for ChatGPT response to complete.");
        }

        // 5. Get current conversation ID from the URL
        const urlCheck = await session.send<{ result?: { value?: string } }>("Runtime.evaluate", { expression: "window.location.href" });
        const currentUrl = urlCheck?.result?.value || "";
        const match = currentUrl.match(/\/c\/([a-zA-Z0-9\-]+)/i);
        const resolvedConversationId = match ? match[1] : (input.conversationId ?? "");

        if (!resolvedConversationId) {
          throw new Error("Could not resolve conversation ID from URL.");
        }

        // 6. Sniff details on reload/navigate to return clean history
        const detailsCaptured = await captureChatGPTNetworkResponses(session, {
          timeoutMs: 15000,
          maxResponses: 5,
          navigateUrl: `https://chatgpt.com/c/${resolvedConversationId}`,
          shouldStop: (capturedList) => {
            const targetPath = `/backend-api/conversation/${resolvedConversationId}`.toLowerCase();
            return capturedList.some((item) => item.responseUrl.toLowerCase().includes(targetPath));
          }
        });

        const parsedResponses = parseJsonResponses(detailsCaptured);
        let messages: ChatGPTMessage[] = [];
        let matched = false;
        const targetPath = `/backend-api/conversation/${resolvedConversationId}`.toLowerCase();
        for (const resp of parsedResponses) {
          if (resp.responseUrl.toLowerCase().includes(targetPath)) {
            messages = parseChatGPTMessageTree(resp.body);
            matched = true;
            break;
          }
        }

        if (!matched) {
          return {
            ok: false,
            error: {
              code: "CHATGPT_CDP_CAPTURE_FAILED",
              message: "Timeout or failed to capture updated conversation details from network responses after sending prompt."
            }
          };
        }

        reporter.done(phase);

        return {
          ok: true,
          conversationId: resolvedConversationId,
          messages,
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
