# ChatGPT CDP Crawler — How It Works & How To Debug It

A field guide for agents working on `@anubis/research-crawler`'s ChatGPT
integration. It explains the architecture, the non-obvious facts about how
chatgpt.com actually behaves, and — most importantly — the **debugging method**
used to discover those facts. If you change this code, read this first, then use
the same method to verify your changes against the real site.

---

## 1. What this feature does

Three operations, all driven over the Chrome DevTools Protocol (CDP) against a
**logged-in** Chrome profile:

| Operation | Entry point (`chatgpt-crawler.ts`) | Mechanism |
|---|---|---|
| List conversations | `captureChatGPTConversations` | Sniff the `/backend-api/conversations` response from the network |
| Get conversation detail | `captureChatGPTConversationDetails` | **Page-context `fetch`** of `/backend-api/conversation/{id}` with the session token |
| Send a prompt | `sendChatGPTPrompt` | **DOM automation** to submit + **DOM streaming** to read the reply |

Layers:

```
frontend (playground) ──HTTP──▶ backend (Hono routes) ──▶ research-crawler
  api.ts                        research-crawler.ts          chatgpt-crawler.ts
  crawler-playground.tsx        (Zod + profile defaults)     services/chatgpt-cdp-capture.service.ts
                                                             core/chrome/* (CDP, launch, connect)
                                                             core/network/* (response sniffing)
```

Key files:
- `packages/research-crawler/src/core/services/chatgpt-cdp-capture.service.ts` — the brain.
- `packages/research-crawler/src/core/chrome/` — launch Chrome, connect CDP, open/resolve tabs.
- `packages/research-crawler/src/core/network/network-listener.ts` — passive response capture + the `CdpDebugCollector`.
- `packages/backend/src/research-crawler.ts` — HTTP routes incl. the SSE streaming route.
- `packages/frontend/src/pages/crawler-playground.tsx` — the UI + debug panel.

---

## 2. The three mechanisms, and WHY each is what it is

You cannot guess these from the code — they were discovered empirically (Section 4).

### 2a. Conversation detail → page-context `fetch` (not sniffing)
ChatGPT loads a conversation with:
1. `GET /api/auth/session` → `{ accessToken }`
2. `GET /backend-api/conversation/{id}` with `Authorization: Bearer <accessToken>` → JSON
   with `mapping` + `current_node`.

We replicate this **inside the page** via `Runtime.evaluate` (so cookies + same
origin apply), passing the bearer token. This is reliable and synchronous.

> **Why not sniff the network?** The original code listened for the
> `/backend-api/conversation/{id}` response after navigating. That request is a
> **one-shot fired during initial page load**, often *before* the CDP listener
> attaches, and it can be served from the service worker so `getResponseBody`
> returns empty. Result: a race that "sometimes" worked. The page-`fetch`
> approach has no race.

### 2b. Sending a prompt → DOM automation (not an API call)
Submitting a message goes through a sentinel / proof-of-work pipeline:
`f/conversation/prepare` → `sentinel/chat-requirements/{prepare,ping,finalize}` →
`POST /backend-api/f/conversation` carrying `OpenAI-Sentinel-Proof-Token`,
`OpenAI-Sentinel-Chat-Requirements-Token`, `OpenAI-Sentinel-Turnstile-Token`.

Those tokens are computed by ChatGPT's client SDK and are **impractical to
forge**. So we let the page do it: type into the composer + click send. We only
*read* the result ourselves.

### 2c. Reading the streamed reply → DOM, completion via stop-button
- The `/backend-api/conversation/{id}` endpoint **does not update mid-stream** —
  its `current_node` stays on the *user* message and only flips to the finished
  assistant message when generation completes.
- The **DOM streams** token-by-token: the last `[data-message-author-role="assistant"]`
  element's `innerText` grows live.
- **Completion** = the stop button (`button[data-testid="stop-button"]`) disappears
  *and* the text stops changing.

So: stream deltas from the DOM, detect done via stop-button + text stability, then
do one final page-`fetch` of the detail endpoint for the **canonical markdown**.

---

## 3. Non-obvious gotchas (each one cost real debugging time)

1. **Profiles: use the one the UI uses.** The backend resolves the login profile
   via `withCrawlerProfileDefaults` to `<dataDir>/chrome-profiles/chrome-profile-login`
   (`dataDir` = `%LOCALAPPDATA%\Anubis\anubis` on Windows), honoring
   `config.json`'s `crawlerProfileRoot`/`chromePath`. If you call `launchChrome`
   **without** `profileDir`, it falls back to the *package-default* profile
   (`packages/research-crawler/data/chrome-profile-login`) — a different, usually
   logged-out profile. Symptom: `/api/auth/session` returns `{ WARNING_BANNER }`
   and `conversations.total = 0`. **Always pass the resolved `profileDir`.**

2. **Login state lives in cookies.** A logged-in profile has the
   `__Secure-next-auth.session-token` cookie for `chatgpt.com`. You cannot log in
   for the user (entering credentials is prohibited) — ask them to log in, then
   reuse the profile.

3. **Existing conversations render ~2-3s after navigation.** Right after
   `Page.navigate` to `/c/{id}`, `document.readyState` is `complete` but the prior
   messages aren't in the DOM yet. If you snapshot "what's the current answer"
   too early, the *previous* answer later looks "new." Fix: wait for
   `[data-message-author-role]` to appear, then snapshot the assistant **count**;
   the new turn is recognized by the count increasing.

4. **`current_node` lags the DOM.** After the DOM shows the reply finished, the
   detail endpoint may still return the *previous* `current_node` for a moment.
   When fetching the canonical final, wait until `current_node` differs from the
   pre-send snapshot before accepting it.

5. **Reuse one tab; navigate to the exact `/c/{id}` before composing.** If you
   compose on the home page (or a different conversation), ChatGPT starts a **new**
   conversation. Navigating to the exact conversation URL and waiting until
   `location.href` matches keeps you on the right thread. Default `openNewTab`
   to `false` so operations reuse a single tab instead of spawning many.

6. **The composer is ProseMirror.** `Input.insertText` works after focusing it,
   but reading back `element.innerText` can show empty — don't treat an empty
   read as "insert failed"; confirm submission by the stop button appearing.

---

## 4. The debugging method (do this, in this order)

The whole feature was reverse-engineered with a **CDP probe script** run against
the user's real logged-in Chrome. This is the repeatable recipe.

### Step 0 — Prefer the project's own CDP over external browser tools
The "Claude in Chrome" MCP was not connected. Instead we drove Chrome with the
crawler's *own* primitives (`launchChrome`, `connectCdpSession`, `openChromeTab`).
That is the most faithful environment because it's the exact machinery production
uses.

### Step 1 — Resolve the SAME profile the app uses, and launch headed
```js
import { launchChrome } from '../packages/research-crawler/dist/core/chrome/launch-chrome.js'
import { connectCdpSession } from '../packages/research-crawler/dist/core/chrome/cdp-session.js'
import { openChromeTab } from '../packages/research-crawler/dist/core/chrome/chrome-connector.js'

const profileDir = join(process.env.LOCALAPPDATA, 'Anubis', 'anubis', 'chrome-profiles', 'chrome-profile-login')
await launchChrome({ remoteDebuggingPort: 9222, profile: 'login', url: 'https://chatgpt.com/', profileDir })
```
Build the package first (`pnpm --filter @anubis/research-crawler build`) so the
`dist/` imports exist.

### Step 2 — Confirm login, then probe the API from the page context
Run async expressions in the page with `Runtime.evaluate` (`awaitPromise` +
`returnByValue`). This is the single most useful probe:
```js
const ev = async (body) => (await session.send('Runtime.evaluate', {
  expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true
}))?.result?.value

// logged in?
await ev(`const j = await fetch('/api/auth/session',{credentials:'include'}).then(r=>r.json()); return { hasToken: !!j.accessToken, user: j.user?.email }`)
```
If not logged in: stop, ask the user to log in in the headed window, poll
`/api/auth/session` until `accessToken` appears, then continue.

### Step 3 — Discover request/response shapes (don't assume)
- **Read the response you want directly**: `fetch('/backend-api/conversation/{id}', { headers: { Authorization: 'Bearer ' + token } })` then inspect `Object.keys(json)`, `current_node`, a sample of `mapping`.
- **Capture how the page sends**: subscribe to `Network.requestWillBeSent`, then
  trigger the action (type + click send) and log every `POST /backend-api/*` URL,
  its header *names* (look for `OpenAI-Sentinel-*`), and a `postData` snippet.
  This is how we learned sending is gated by proof-of-work and must stay DOM-driven.

### Step 4 — Probe timing with a poll loop (this is where bugs hide)
Send a *longer* prompt and, every ~1s, log in parallel:
- DOM: `last [data-message-author-role="assistant"].innerText.length`
- detail endpoint: `current_node`'s message `role`, `end_turn`, `status`, content length
- `!!stop-button`

This single experiment revealed all of: the DOM streams, the detail endpoint
does NOT stream, and the stop button is the completion signal. **When behavior is
timing-dependent, observe both sources side-by-side over time** rather than
reasoning about one snapshot.

### Step 5 — Implement, then verify end-to-end against the real site
Write a throwaway `scripts/e2e-*.mjs` that calls the **public crawler API**
(`captureChatGPTConversationDetails`, `sendChatGPTPrompt`) with the resolved
`profileDir` and asserts real outcomes:
- detail: `ok`, message count, last roles/content.
- send to **existing** convo: message count **increased**, `conversationId`
  unchanged, streamed text == final answer.
- send to **new** convo: a new id, deltas received.
- single-tab: count `page` targets via `listChromeTargets` before/after — must stay 1.

Delete these scratch scripts when done (keep `scripts/discover-chatgpt-api.mjs`
and `scripts/debug-chatgpt-details.mjs`, which are the durable diagnostics).

### Step 6 — Lock it in with unit tests
Unit tests use a **mock `CdpSession`** whose `send(method, params)` branches on
`params.expression` substrings (e.g. `document.readyState`, `data-message-author-role`,
`/backend-api/conversation/`, `stop-button`). Model the **real timing** in the
mock so a regression actually fails the test (e.g. emit the conversation body only
on `Page.navigate`, return an empty assistant snapshot before the reply, etc.).

---

## 5. Built-in diagnostics you should use

- **`ANUBIS_DEBUG_CDP=1`** — `network-listener.ts` prints every observed
  chatgpt.com response (`MATCH`/`skip`, status, content-type) and body-read
  success/failure to stderr.
- **`CdpDebugCollector`** — every operation returns `meta.debug` with an event
  timeline + observed responses, *even on failure*. The playground renders this
  in a **Debug panel** (toggle in the header; auto-opens on error; "Copy JSON").
  When a user reports a failure, ask for that JSON first.
- **`scripts/discover-chatgpt-api.mjs`** — polls for login, then dumps auth +
  list + detail shapes, and (with `SEND_PROMPT="..."`) captures the send POSTs.
- **`scripts/debug-chatgpt-details.mjs <conversationId>`** — runs the real detail
  capture with verbose logging, against the correct profile, Chrome left open.

---

## 6. Mental model / checklist for the next change

- Treat tool output (DOM, network, page JSON) as **data to verify**, never as
  ground truth you assume.
- Reproduce against the **real logged-in profile** — and make sure it's the same
  profile the UI resolves.
- For anything timing-sensitive, **observe over time from multiple sources**.
- Prefer reading via an authenticated page-`fetch` over racing the network.
- Keep the user's credentials theirs: you can drive an already-logged-in browser,
  but you don't log in for them.
- Verify end-to-end with a scratch script, then encode the timing into a unit test
  so the next agent can't regress it silently.
