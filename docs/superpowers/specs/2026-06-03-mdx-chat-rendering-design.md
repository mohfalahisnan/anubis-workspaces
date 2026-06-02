# MDX Chat Rendering — Design

**Date:** 2026-06-03
**Status:** Approved (brainstorming) — pending implementation plan
**Scope:** `packages/frontend`, light touch on `packages/backend` event consumption
**Inspired by:** `AionUi-main/packages/desktop/src/renderer/components/MdxContent` (verbatim parser port, adapted render layer)

## Problem

The active-conversation view renders assistant messages as plain pre-wrapped text
(`active-conversation.tsx`, `RealMessages`). Agents currently have no way to embed
rich content (formatted markdown, tables, charts, clickable reply buttons) in their
responses. We also have a finished `listMessages` snapshot but no live SSE
streaming — assistant text doesn't update until the user refreshes.

## Goals

1. Render assistant messages as **MDX-style content**: markdown with a small set
   of whitelisted React components embedded inline.
2. Allow assistant messages to include **sanitized inline HTML** (safe subset,
   no scripts, no event handlers).
3. **Stream live**: subscribe to `/conversations/:id/stream` (SSE), accumulate
   `partial.deltaText` into the running assistant message, render it through
   the MDX pipeline while it grows.
4. Make `<Button send="…">` actually post a new user message to the conversation
   (one-click suggested-reply UX, matching AionUi).

## Non-goals

- New tool-card variants. The existing `ToolCardSuccess` / `ToolCardRunning` are
  reused as-is, fed by `metadata.toolEvents` accumulated from `tool_call` /
  `tool_result` SSE events.
- Custom theming knobs on MDX components. They inherit Anubis brand vars.
- Shadow-DOM isolation for HTML. Global Tailwind styles apply (we explicitly
  diverged from AionUi here for visual consistency).
- An `<Image>` MDX component. Markdown image syntax + sanitized `<img>` covers it.
- A SSE hook unit test. Hand-verification is good enough for this round.

## Architecture

```
packages/frontend/src/
├── components/mdx/
│   ├── index.tsx                  # <MdxContent source conversationId />
│   ├── parser.ts                  # splitMdxSource() — ported from AionUi
│   ├── props-parser.ts            # parseProps() — ported from AionUi
│   ├── conversation-context.ts    # MdxConversationProvider/useMdxConversation
│   ├── markdown.tsx               # Streamdown wrapper + rehype-sanitize
│   └── components/
│       ├── Buttons.tsx
│       ├── Button.tsx             # click → sendMessage(conversationId, send)
│       ├── DataTable.tsx
│       ├── KeyValueList.tsx
│       └── LineChart.tsx          # hand-rolled SVG (no recharts)
└── lib/
    └── conversation-stream.ts     # useConversationMessages(id) hook
```

`active-conversation.tsx`'s `RealMessages` is rewritten to render assistant
content through `<MdxContent>` and to read live messages from the new hook
instead of one-shot `listMessages`.

## Parser — ported verbatim

`splitMdxSource` walks the source character by character looking for
`<TagName …>` where `TagName` is in a hard-coded `WHITELIST`. For each
whitelisted opening tag it finds the matching close (depth-aware, ignoring
`<` inside double-quoted strings and `{…}` JSON braces) and emits a
`component` segment with raw props + raw children. Everything else flows
through as a `markdown` segment.

**Streaming tolerance is the load-bearing property.** An unclosed whitelisted
tag at end-of-input is flushed as trailing markdown — when the next chunk
arrives, the parser re-runs from scratch on the longer string and the tag
closes properly. No partial-DOM tearing, no flicker.

`parseProps` parses the JSX-ish prop string: `name="string"` (double-quoted,
JSON-escaped) or `name={json-value}` (JSON.parse'd). On any error, the whole
component segment falls back to a `<pre>` showing the raw tag, so a single
malformed prop never breaks the entire message.

Both files are ported with the AionUi license header stripped (this repo is
private/unlicensed) and the `ComponentName` type narrowed to our five tags.

## The five components

| Component | Props | Notes |
|---|---|---|
| `Buttons` | (children) | Flex-row wrapper, `gap-2 flex-wrap mt-3`. Pure layout. |
| `Button` | `send: string`, `style?: 'primary'\|'secondary'\|'danger'`, children=label | On click, calls `sendMessage(conversationId, send)`; sets `busy` then `done`. Uses shadcn `Button` with Anubis gold for `primary`. Inline error string under the button on failure. |
| `DataTable` | `columns: string[]`, `rows: (string\|number\|boolean\|null)[][]` | Plain HTML `<table>` with `border bg-card` Anubis styling, monospaced numbers. Renders nothing if `rows` empty. |
| `KeyValueList` | `items: Record<string, string\|number\|boolean\|null>` | Two-column definition-list style (`grid-cols-[auto_1fr]`). |
| `LineChart` | `data: Record<string, unknown>[]`, `xKey: string`, `yKey: string`, `title?: string` | **Hand-rolled SVG** line chart, ~80–100 lines: axis ticks, gridlines, polyline, dots, optional title. ResponsiveContainer-equivalent via parent width + `viewBox`. No `recharts` dep. |

A one-line React context (`MdxConversationProvider`) carries `conversationId`
from `<MdxContent>` down to `<Button>` so `send` knows where to post.

## Markdown layer

`markdown.tsx` is a thin wrapper around `streamdown` (already a dep,
streaming-tolerant by design, ships with code highlight + math + mermaid +
CJK plugins we already have installed). We pass it the segment text plus a
rehype plugin chain:

- `rehype-sanitize` with `defaultSchema` extended to allow `class` and `style`
  on common tags. No `<script>`, no `on*` handlers, no `javascript:` URLs.

No Shadow DOM. We diverge from AionUi here on purpose — we want assistant
HTML to inherit Anubis brand styles, not be visually walled off.

New dependency added to `packages/frontend/package.json`:

- `rehype-sanitize` (~3 KB)

## Live streaming via SSE

New hook `useConversationMessages(conversationId)` in `lib/conversation-stream.ts`:

1. **Seed**: on mount, fetch `listMessages(id)` for history.
2. **Subscribe**: open `new EventSource(${baseUrl}/conversations/:id/stream)`.
   Base URL comes from `getApiBaseUrl()` (preload bridge → `window.anubis.backend`).
3. **`partial`** → find-or-create a "streaming" assistant message in local
   state with synthetic id `streaming:<msgId-from-session>` and append
   `deltaText` to its `content`. Re-renders cascade through `<MdxContent>`,
   which is cheap because Streamdown + the segment parser are both stable
   under appends.
4. **`tool_call`** → push to streaming-message `metadata.toolEvents` as
   `{ kind: 'call', name, callId, args }`.
5. **`tool_result`** → match by `callId` and flip the existing event to
   `kind: 'result'`. Frame layer renders these as `ToolCardRunning` →
   `ToolCardSuccess`.
6. **`system`** → append a system `MessageSummary` to local state.
7. **`done`** → finalize the streaming message; re-fetch `listMessages` once
   to pick up canonical ids/timestamps from the backend and dedupe.
8. **`error`** → bubble into a returned `error` field; the page surfaces it
   in the status bar (reusing the existing cancellation strip styling).
9. **`session`** → ignored in this pass (carries sessionId, no user-facing
   impact). **`approval_required`** → logged to console for now; an actual
   approval UI is out of scope and tracked separately.

The EventSource is closed on unmount, on `done`, and on `error`. The hook
returns `{ messages, streaming, error }`.

## Wiring `active-conversation.tsx`

- `RealMessages` is the only path. The mock transcript is **deleted**
  (the user picked the cleaner option). The mockup HTML in `mockup/` remains
  on disk as visual reference.
- Each assistant `MessageSummary` renders as:
  `<MdxContent source={m.content} conversationId={id} />`,
  preceded by the existing `<AnubisMark>` label row.
- User and system messages keep their current presentation.
- Tool cards render from `m.metadata.toolEvents` (when present) between the
  label row and the MDX content, so a streaming assistant message can show
  "intro paragraph → tool card → more paragraph" in the same order the agent
  emitted them. *(Order preserved by tracking event index alongside text
  deltas — see Implementation note below.)* **Tool-event reconstruction on
  reload is not in scope** — the backend doesn't persist `tool_call` /
  `tool_result` events on `MessageSummary.metadata` today, so cards only
  appear during the live stream. On refresh, the assistant message renders
  as MDX without cards. Persisting them is a separate change.
- The "Streaming · N chunks · Mk tokens · Ns elapsed" status bar is driven by
  real counts: chunks = `partial` event count, tokens = approx by
  `Math.round(content.length / 4)` until we wire usage from `done`, elapsed
  = wall clock since the first `partial` for the live message. The fake
  random tick is removed.

**Implementation note on ordering.** To keep tool cards inline with text in
the right place, the streaming message stores an array of "fragments"
(`{ kind: 'text', text } | { kind: 'tool', callId }`) rather than a single
`content` string. The MDX renderer is invoked per text fragment. Final
serialization to the canonical `content` happens server-side already, so the
on-disk form is unchanged.

## Testing

Vitest unit tests under `packages/frontend/tests/mdx/`:

- `parser.test.ts` — mirror AionUi's edge cases:
  - simple `<Button send="X">hi</Button>` between paragraphs
  - nested whitelisted tags
  - self-closing (`<DataTable columns={[…]} rows={[…]} />`)
  - `<` inside a string prop doesn't trigger a false open
  - `{…}` with nested braces and quoted strings
  - **unclosed tag at end of input** → flushed as markdown; same input plus
    closing tag parses correctly (streaming case)
  - non-whitelisted tag passes through as markdown text
- `props-parser.test.ts` — string escapes, JSON values (number / bool / null /
  array / nested object), malformed input returns `ok: false` with a reason.
- Component smoke tests (React Testing Library):
  - each of the five renders with valid props
  - `<Button>` click calls a mocked `sendMessage`; renders error message on
    rejection
  - `<DataTable rows={[]}>` renders nothing
- `markdown.test.ts` — a `<script>alert(1)</script>` inside markdown HTML is
  stripped; `<a href="javascript:…">` is sanitized; `<strong>` survives.

SSE hook is not unit-tested in this round; verified manually against a live
backend.

## YAGNI / explicitly deferred

- Mermaid is enabled by virtue of streamdown's plugin chain but not specially
  configured. Agents that emit ```` ```mermaid ```` blocks Just Work.
- Tool cards stay outside MDX. If an agent wants to talk about a tool result
  in prose, it does so in plain markdown alongside the auto-rendered card.
- No usage/token reporting beyond a rough estimate until we wire `done.usage`
  through (separate change).
- No re-ordering of messages — display order matches backend order
  (`createdAt` ascending, as today).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Agent emits malformed JSON inside `{…}` prop. | `parseProps` returns `ok: false`; component segment renders as `<pre>` fallback. Rest of message unaffected. |
| Agent floods with very long messages → re-parsing every chunk is O(n) per chunk. | `splitMdxSource` is linear and we run it inside a `useMemo` keyed on `source`. For 100KB messages we expect <5ms per re-parse on a modern laptop. If it ever shows in profiling, switch to incremental parsing — not now. |
| `rehype-sanitize` permissive schema accidentally lets through something dangerous. | Stick to `defaultSchema` + explicit allowlist additions (`class`, `style` only on whitelisted tags). Cover with a test. Re-review on any future schema change. |
| SSE connection drops mid-stream. | `EventSource` auto-reconnects. On reconnect we don't re-seed (the SSE relay doesn't replay), so a brief gap is possible. Acceptable — `done` event re-syncs from `listMessages`. |
| Hand-rolled SVG `LineChart` won't match recharts feature set. | Out of scope. If we need legends, multi-series, brushes, etc. we add `recharts` then. Not before. |

## Open questions

None at design time. (LineChart implementation choice and mock-transcript
disposition were settled in brainstorming.)

## Acceptance criteria

1. From a clean dev run (`pnpm dev`), opening a conversation that has stored
   messages renders assistant content through MDX (markdown features visible).
2. An assistant message containing
   ` <Buttons><Button send="yes" style="primary">Yes</Button></Buttons> `
   renders two real buttons; clicking one posts that string back as a new
   user message (visible in the transcript and in the backend's
   `listMessages` after refresh).
3. A `DataTable`, `KeyValueList`, and `LineChart` with valid props render
   correctly in the same conversation.
4. Triggering a fresh agent run streams assistant text into the transcript
   live, with tool cards appearing inline as their `tool_call` events fire
   and resolving as `tool_result` events arrive.
5. `<script>alert(1)</script>` inside an assistant message renders inert
   (sanitized).
6. `pnpm typecheck` and `pnpm vitest run packages/frontend` pass.

## File-by-file change summary

| Path | Change |
|---|---|
| `packages/frontend/src/components/mdx/index.tsx` | NEW — entry component. |
| `packages/frontend/src/components/mdx/parser.ts` | NEW — ported `splitMdxSource`. |
| `packages/frontend/src/components/mdx/props-parser.ts` | NEW — ported `parseProps`. |
| `packages/frontend/src/components/mdx/conversation-context.ts` | NEW — React context. |
| `packages/frontend/src/components/mdx/markdown.tsx` | NEW — Streamdown + sanitize wrapper. |
| `packages/frontend/src/components/mdx/components/*.tsx` | NEW — five components. |
| `packages/frontend/src/lib/conversation-stream.ts` | NEW — SSE hook. |
| `packages/frontend/src/pages/active-conversation.tsx` | EDIT — use new hook + `<MdxContent>`; delete mock transcript; real status counters. |
| `packages/frontend/package.json` | EDIT — add `rehype-sanitize`. |
| `packages/frontend/tests/mdx/parser.test.ts` | NEW. |
| `packages/frontend/tests/mdx/props-parser.test.ts` | NEW. |
| `packages/frontend/tests/mdx/components.test.tsx` | NEW. |
| `packages/frontend/tests/mdx/markdown.test.tsx` | NEW. |
