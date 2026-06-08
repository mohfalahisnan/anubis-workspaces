# Qwen CDP Crawler — How It Works & How To Debug It

A field guide for agents working on `@anubis/research-crawler`'s Qwen
(chat.qwen.ai) integration. It mirrors `docs/chatgpt-crawler-cdp.md` but records
the facts that are **specific to Qwen** — discovered empirically with the CDP
probe (`scripts/discover-qwen-api.mjs`), not assumed. If you change this code,
read this first, then use the same method to verify against the real site.

---

## 1. What this feature does

Three operations, all driven over the Chrome DevTools Protocol (CDP) against a
**logged-in** Chrome profile (the same `login` profile the ChatGPT crawler uses):

| Operation | Entry point (`qwen-crawler.ts`) | Mechanism |
|---|---|---|
| List conversations | `captureQwenConversations` | **Page-context `fetch`** of `/api/v2/chats/?page=1` |
| Get conversation detail | `captureQwenConversationDetails` | **Page-context `fetch`** of `/api/v2/chats/{id}` |
| Send a prompt | `sendQwenPrompt` | **DOM automation** to submit + **DOM streaming** to read the reply |

Layers (identical wiring to ChatGPT):

```
frontend (qwen-playground) ─HTTP→ backend (Hono /qwen/* routes) ─→ research-crawler
  api.ts (getQwen*/streamQwenPrompt)   research-crawler.ts            qwen-crawler.ts
                                       (Zod + profile defaults)       services/qwen-cdp-capture.service.ts
                                                                      core/chrome/* (CDP, launch, connect)
```

Key files:
- `packages/research-crawler/src/core/services/qwen-cdp-capture.service.ts` — the brain.
- `packages/research-crawler/src/core/qwen-crawler.ts` — public entry functions.
- `packages/research-crawler/src/core/chrome/chrome-connector.ts` — `resolveQwenTarget`.
- `packages/backend/src/research-crawler.ts` — HTTP routes incl. the SSE streaming route.
- `packages/frontend/src/pages/qwen-playground.tsx` — the UI + debug panel.
- `scripts/discover-qwen-api.mjs` — the durable discovery probe.

---

## 2. The three mechanisms, and WHY each is what it is

### 2a. Auth is cookie-based — no bearer token to forge
`GET /api/v1/auths/` returns **200 + the user object** when logged in, **401**
otherwise. Page-context `fetch(path, { credentials: 'include' })` carries the
session cookies (`ssxmod_itna`, `tfstk`, `cna`, …), so reads work **without** an
`Authorization` header. We use `/api/v1/auths/` purely as the login check.

> ChatGPT needed a bearer token from `/api/auth/session`; Qwen does not. The
> `token` field that `/api/v1/auths/` returns is unnecessary for GETs.

### 2b. List + detail → page-context `fetch` (not network sniffing)
- List: `GET /api/v2/chats/?page=1` → `{ success, request_id, data: ChatSummary[] }`.
  Each summary: `{ id, title, created_at, updated_at, chat_type, … }` (timestamps
  are epoch **seconds**). Note the version: **`/api/v2/`** works; `/api/v1/chats/`
  returns 401.
- Detail: `GET /api/v2/chats/{id}` → `{ data: { chat: { history: { messages, currentId } } } }`.
  `history.messages` is a **map** keyed by message id with `parentId`/`childrenIds`
  pointers — a tree, like ChatGPT's `mapping`. We trace from `currentId` up the
  `parentId` chain and reverse.

Page-`fetch` (vs. sniffing) avoids the same race ChatGPT had: the request fires
during initial load, often before a CDP listener attaches.

### 2c. Assistant text lives in `content_list[]`, phase `"answer"`
This is the single most surprising Qwen fact. For an **assistant** node the
top-level `content` is an **empty string**; the real text is in
`content_list[]`, an array of blocks each with a `phase`:
- `phase: "thinking_summary"` → reasoning (its `content` is empty; summary lives in `extra`).
- `phase: "answer"` → the actual reply (`content: "pong"`).

So `extractQwenText` joins the `phase === "answer"` blocks (falling back to any
non-empty block). **User** nodes use the plain `content` string.

### 2d. Sending → DOM automation (the real POSTs are anti-bot gated)
The page sends via `POST /api/v2/chats/new` then
`POST /api/v2/chat/completions?chat_id=…` (an SSE `text/event-stream`). Those
POSTs carry Alibaba anti-bot headers **`bx-ua`, `bx-umidtoken`, `bx-v`** computed
by the page's JS SDK — the Qwen analogue of ChatGPT's `OpenAI-Sentinel-*`
tokens, and just as impractical to forge. So we let the page do it: type into the
composer + submit, and only *read* the result ourselves.

### 2e. Reading the streamed reply → DOM, completion via stop-button
- The composer is `textarea.message-input-textarea`.
- The new turn is the last `.qwen-chat-message-assistant` element; recognise it by
  the assistant **count** growing past the pre-send snapshot.
- **Completion** = the `button.stop-button` disappears *and* the text stops changing.
- Then one page-`fetch` of `/api/v2/chats/{id}` for the **canonical** answer
  (`content_list` phase `answer`). `currentId` lags the DOM, so wait until it
  advances past the pre-send `currentId` before accepting.

---

## 3. Non-obvious gotchas (each one cost real debugging time)

1. **Guest vs. logged-in.** chat.qwen.ai works as a **guest**: a logged-out
   session shows "Log in"/"Sign up", lands sends at `/c/guest` with
   `chat_mode:"guest"`, and `/api/v1/auths/` returns 401. Always gate on the
   auth check and surface "not logged in" rather than silently capturing guest
   data. Logged-in sends use `chat_mode:"normal"`.

2. **The answer-phase node reads empty mid-stream.** During the "thinking"
   phase (Qwen reasons before answering) `.response-message-content.phase-answer`
   either doesn't exist or its `innerText` is empty even while text is visible.
   For live deltas, prefer that node's text **only when non-empty**, else fall
   back to the whole `.qwen-chat-message-assistant` `innerText` — otherwise
   `onDelta` never fires for fast/short replies.

3. **Submission can be dropped right after navigation.** The SPA needs a beat to
   bind the composer's Enter handler; the first keypress is silently lost. Settle
   ~600ms, then **submit-and-confirm with retry** — re-insert the prompt if the
   composer is empty, and confirm by EITHER a fresh `/c/{id}` URL OR generation
   starting (the stop button / a new assistant turn).

4. **URL placeholders.** A new chat is briefly at `/c/new-chat` (and a guest at
   `/c/guest`) before the real id. Exclude both literal ids when resolving the
   conversation id from `location.href`.

5. **`currentId` lags the DOM.** Just after the DOM shows the reply finished, the
   detail endpoint can still return the previous `currentId` with empty answer
   content. Poll `/api/v2/chats/{id}` until `currentId` differs from the pre-send
   snapshot and the last assistant `content_list` answer is non-empty.

6. **Use the same login profile the UI uses.** Resolved by
   `withCrawlerProfileDefaults` to `<dataDir>/chrome-profiles/chrome-profile-login`.
   You cannot log in for the user — ask them to sign in at chat.qwen.ai once, then
   reuse the profile.

---

## 4. The debugging method (do this, in this order)

The whole feature was reverse-engineered with `scripts/discover-qwen-api.mjs`,
run against the user's real Chrome. Repeatable recipe (build first:
`pnpm --filter @anubis/research-crawler build`):

### Step 1 — Resolve the SAME profile the app uses, launch headed
The probe resolves the login profile exactly like the backend and launches Chrome
at `https://chat.qwen.ai/` on port 9222.

### Step 2 — Confirm login, then probe from the page context
Run async expressions in the page with `Runtime.evaluate` (`awaitPromise` +
`returnByValue`). The probe polls `/api/v1/auths/` for 200 and dumps the user.

### Step 3 — Discover request/response shapes (don't assume)
- Read the list/detail directly: `fetch('/api/v2/chats/?page=1', {credentials:'include'})`,
  inspect `data`, then `fetch('/api/v2/chats/{id}')` and inspect
  `data.chat.history.{messages,currentId}` and a node's `content_list`.
- Capture how the page sends: subscribe to `Network.requestWillBeSent`, trigger a
  send, and log every `POST /api/*` URL + header names (look for `bx-ua`,
  `bx-umidtoken`, `bx-v`) + a `postData` snippet. This is how we learned sending
  is anti-bot gated and must stay DOM-driven.

### Step 4 — Probe timing with a poll loop (this is where bugs hide)
Send a *longer* prompt and, every ~1s, log side-by-side: the last
`.qwen-chat-message-assistant` text length, `!!button.stop-button`, and the
detail endpoint's `currentId`/answer content. This revealed the thinking-phase
empty-node behavior and that the stop button is the completion signal.

### Step 5 — Verify end-to-end against the real site
A throwaway script calls the public crawler API (`captureQwenConversations`,
`captureQwenConversationDetails`, `sendQwenPrompt`) with the resolved `profileDir`
and asserts: list returns real chats; send-to-new returns a fresh id + streamed
deltas == final answer; follow-up into the same convo grows the message count.

### Step 6 — Lock it in with unit tests
`packages/research-crawler/tests/qwen-cdp-capture.service.test.ts` uses a **mock
`CdpSession`** that branches on `params.expression` substrings (`/api/v1/auths/`,
`/api/v2/chats/`, `qwen-chat-message-assistant`, `stop-button`,
`window.location.href`) and models the real shapes (incl. `content_list` answer
phase). Run them with the node test runner:
`node --import tsx --test packages/research-crawler/tests/qwen-cdp-capture.service.test.ts`.

---

## 5. Built-in diagnostics you should use

- **`CdpDebugCollector`** — every operation returns `meta.debug` with an event
  timeline + observed (page-`fetch`) responses, even on failure. The playground
  renders this in a **Debug panel** ("Copy JSON"). Ask for that JSON first when a
  user reports a failure.
- **`scripts/discover-qwen-api.mjs`** — polls for login, dumps auth + list +
  detail + DOM shapes, and (with `SEND_PROMPT="..."`) captures the send POSTs.

---

## 6. Mental model / checklist for the next change

- Treat tool output (DOM, network, page JSON) as **data to verify**, never ground truth.
- Reproduce against the **real logged-in profile** — the same one the UI resolves.
- For anything timing-sensitive, **observe over time from multiple sources**.
- Prefer reading via an authenticated page-`fetch` over racing the network.
- Remember the two Qwen-isms: assistant text is in `content_list` (phase `answer`),
  and submission may need a retry right after navigation.
- Keep the user's credentials theirs: drive an already-logged-in browser; don't log in for them.
