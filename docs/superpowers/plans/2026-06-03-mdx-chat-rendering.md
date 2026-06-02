# MDX Chat Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render assistant messages as streaming-tolerant MDX (markdown + whitelisted React components + sanitized inline HTML) inside the active-conversation view, wired to live SSE updates from `/conversations/:id/stream`.

**Architecture:** Hand-rolled segment parser (ported from AionUi) splits each message body into interleaved `markdown` and `component` segments. Markdown segments go through Streamdown (built-in sanitization). Component segments render from a hard-coded whitelist of five React components. A new SSE hook accumulates `partial.deltaText` events into a live assistant message that re-renders on every chunk; tool events accumulate as a `metadata.toolEvents` array shown by the existing tool-card UI.

**Tech Stack:** React 19, TypeScript, Streamdown (markdown + sanitization), Vitest + jsdom + @testing-library/react for tests, no new runtime deps for rendering.

**Spec:** [docs/superpowers/specs/2026-06-03-mdx-chat-rendering-design.md](../specs/2026-06-03-mdx-chat-rendering-design.md)

---

## Pre-flight check (do this first)

- [ ] **Step 0a: Confirm you are in the repo root** — `pwd` should print `C:\Projects\anubis-workspaces` (or your equivalent). All commands below run from there unless noted.
- [ ] **Step 0b: Confirm node and pnpm** — run `node -v` (expect `v22.x` or higher) and `pnpm -v` (expect `9.x` or `10.x`).
- [ ] **Step 0c: Baseline status** — run `git status` (expect a clean working tree on `main`).

---

## Task 1: Set up frontend testing infrastructure

The frontend currently has zero tests. We need jsdom + @testing-library/react so subsequent tasks can test React components.

**Files:**
- Create: `packages/frontend/vitest.config.ts`
- Create: `packages/frontend/tests/setup.ts`
- Modify: `packages/frontend/package.json` (add devDependencies)
- Modify: `vitest.config.ts` (root) — already globs `packages/*/tests/**`, no change needed; verify.

- [ ] **Step 1.1: Add dev dependencies**

Run from repo root:

```bash
pnpm --filter @anubis/frontend add -D jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

Expected: pnpm adds these to `packages/frontend/package.json` devDependencies and updates the lockfile. No build/typecheck step happens.

- [ ] **Step 1.2: Create `packages/frontend/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    css: false,
  },
})
```

- [ ] **Step 1.3: Create `packages/frontend/tests/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 1.4: Verify the root vitest config picks up frontend tests**

Open `vitest.config.ts` at the repo root and confirm the `include` glob `packages/*/tests/**/*.{test,spec}.?(c|m)[jt]s?(x)` covers our future `packages/frontend/tests/**/*.test.tsx`. No edit needed — just confirm by reading the file.

- [ ] **Step 1.5: Sanity test that the setup runs**

Create `packages/frontend/tests/_setup-smoke.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

describe('frontend test setup', () => {
  it('renders into jsdom', () => {
    render(<p>hello</p>)
    expect(screen.getByText('hello')).toBeInTheDocument()
  })
})
```

Run: `pnpm vitest run packages/frontend/tests/_setup-smoke.test.tsx`

Expected: 1 test passes.

- [ ] **Step 1.6: Delete the smoke file**

```bash
rm packages/frontend/tests/_setup-smoke.test.tsx
```

- [ ] **Step 1.7: Add a `test` script to the frontend package**

Edit `packages/frontend/package.json`. Inside `"scripts"`, add (preserving existing scripts):

```json
"test": "vitest run"
```

So the scripts block reads:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "typecheck": "tsc -p tsconfig.json --noEmit",
  "test": "vitest run"
}
```

- [ ] **Step 1.8: Commit**

```bash
git add packages/frontend/package.json packages/frontend/vitest.config.ts packages/frontend/tests/setup.ts pnpm-lock.yaml
git commit -m "chore(frontend): add vitest + testing-library setup"
```

---

## Task 2: Port the MDX segment parser (`parser.ts`) — TDD

The parser is the load-bearing piece. It must be linear, depth-aware, and tolerant of an unclosed whitelisted tag at end-of-input (streaming case).

**Files:**
- Create: `packages/frontend/src/components/mdx/parser.ts`
- Create: `packages/frontend/tests/mdx/parser.test.ts`

- [ ] **Step 2.1: Write the failing tests**

Create `packages/frontend/tests/mdx/parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { splitMdxSource } from '@/components/mdx/parser'

describe('splitMdxSource', () => {
  it('returns a single markdown segment for plain text', () => {
    expect(splitMdxSource('hello **world**')).toEqual([
      { kind: 'markdown', text: 'hello **world**' },
    ])
  })

  it('treats non-whitelisted tags as plain markdown text', () => {
    const out = splitMdxSource('see <Foo bar="1" />')
    expect(out).toEqual([{ kind: 'markdown', text: 'see <Foo bar="1" />' }])
  })

  it('splits a single whitelisted self-closing component', () => {
    const out = splitMdxSource('before <DataTable columns={["a"]} rows={[["1"]]} /> after')
    expect(out).toHaveLength(3)
    expect(out[0]).toEqual({ kind: 'markdown', text: 'before ' })
    expect(out[1]).toMatchObject({
      kind: 'component',
      name: 'DataTable',
      childrenRaw: '',
    })
    expect((out[1] as any).propsRaw).toContain('columns={["a"]}')
    expect(out[2]).toEqual({ kind: 'markdown', text: ' after' })
  })

  it('splits a whitelisted block component with children', () => {
    const out = splitMdxSource('q? <Buttons><Button send="yes">Yes</Button></Buttons> done')
    expect(out).toHaveLength(3)
    expect(out[1]).toMatchObject({
      kind: 'component',
      name: 'Buttons',
      propsRaw: '',
      childrenRaw: '<Button send="yes">Yes</Button>',
    })
  })

  it('does not treat < inside a string prop as a new tag', () => {
    const out = splitMdxSource('<Button send="a<b">x</Button>')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'component', name: 'Button' })
    expect((out[0] as any).propsRaw).toBe('send="a<b"')
  })

  it('handles { } JSON props with nested braces and quoted strings', () => {
    const src = '<DataTable columns={["a","b"]} rows={[[1,2],[3,4]]} />'
    const out = splitMdxSource(src)
    expect(out).toHaveLength(1)
    expect((out[0] as any).propsRaw).toBe('columns={["a","b"]} rows={[[1,2],[3,4]]}')
  })

  it('flushes an unclosed whitelisted tag at end of input as trailing markdown', () => {
    const partial = 'before <Buttons><Button send="ye'
    const out = splitMdxSource(partial)
    expect(out).toEqual([{ kind: 'markdown', text: partial }])
  })

  it('closes the tag once the next chunk completes it', () => {
    const full = 'before <Buttons><Button send="yes">Yes</Button></Buttons>'
    const out = splitMdxSource(full)
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ kind: 'component', name: 'Buttons' })
  })

  it('handles two whitelisted components in sequence', () => {
    const out = splitMdxSource('<Button send="a">A</Button><Button send="b">B</Button>')
    expect(out).toHaveLength(2)
    expect(out.every((s) => s.kind === 'component')).toBe(true)
  })
})
```

- [ ] **Step 2.2: Run tests, confirm they fail**

Run: `pnpm vitest run packages/frontend/tests/mdx/parser.test.ts`

Expected: All tests fail with `Failed to resolve import "@/components/mdx/parser"`.

- [ ] **Step 2.3: Implement `parser.ts`**

Create `packages/frontend/src/components/mdx/parser.ts`:

```ts
export type ComponentName =
  | 'Buttons'
  | 'Button'
  | 'DataTable'
  | 'KeyValueList'
  | 'LineChart'

const WHITELIST: ReadonlySet<string> = new Set<ComponentName>([
  'Buttons',
  'Button',
  'DataTable',
  'KeyValueList',
  'LineChart',
])

export type Segment =
  | { kind: 'markdown'; text: string }
  | { kind: 'component'; name: ComponentName; propsRaw: string; childrenRaw: string }

/**
 * Split a message body into interleaved markdown and component segments.
 * Whitelisted tags only — anything else flows through as markdown text.
 * Unclosed whitelisted tag at end of input ⇒ flushed as trailing markdown
 * (streaming-tolerance hook: the next chunk completes it).
 */
export function splitMdxSource(source: string): Segment[] {
  const segments: Segment[] = []
  let mdStart = 0
  let i = 0
  const n = source.length

  const flushMd = (end: number) => {
    if (end > mdStart) segments.push({ kind: 'markdown', text: source.slice(mdStart, end) })
  }

  while (i < n) {
    if (source[i] !== '<') {
      i++
      continue
    }
    let j = i + 1
    const nameStart = j
    while (j < n && /[A-Za-z]/.test(source[j]!)) j++
    const tagName = source.slice(nameStart, j)
    if (!WHITELIST.has(tagName)) {
      i = j
      continue
    }
    const openEnd = findOpenTagEnd(source, j)
    if (openEnd === -1) {
      flushMd(n)
      mdStart = n
      return segments
    }
    const selfClosing = source[openEnd - 1] === '/'
    const propsRaw = source.slice(j, selfClosing ? openEnd - 1 : openEnd).trim()

    if (selfClosing) {
      flushMd(i)
      segments.push({ kind: 'component', name: tagName as ComponentName, propsRaw, childrenRaw: '' })
      i = openEnd + 1
      mdStart = i
      continue
    }

    const closeIdx = findMatchingClose(source, openEnd + 1, tagName)
    if (closeIdx === -1) {
      flushMd(n)
      mdStart = n
      return segments
    }
    flushMd(i)
    segments.push({
      kind: 'component',
      name: tagName as ComponentName,
      propsRaw,
      childrenRaw: source.slice(openEnd + 1, closeIdx),
    })
    i = closeIdx + ('</' + tagName + '>').length
    mdStart = i
  }

  flushMd(n)
  return segments
}

function findOpenTagEnd(source: string, from: number): number {
  let i = from
  const n = source.length
  while (i < n) {
    const c = source[i]
    if (c === '"') {
      i++
      while (i < n && source[i] !== '"') {
        if (source[i] === '\\' && i + 1 < n) i += 2
        else i++
      }
      if (i >= n) return -1
      i++
    } else if (c === '{') {
      let depth = 1
      i++
      while (i < n && depth > 0) {
        if (source[i] === '"') {
          i++
          while (i < n && source[i] !== '"') {
            if (source[i] === '\\' && i + 1 < n) i += 2
            else i++
          }
          if (i >= n) return -1
          i++
        } else if (source[i] === '{') {
          depth++
          i++
        } else if (source[i] === '}') {
          depth--
          i++
        } else {
          i++
        }
      }
      if (depth !== 0) return -1
    } else if (c === '>') {
      return i
    } else {
      i++
    }
  }
  return -1
}

function findMatchingClose(source: string, from: number, tagName: string): number {
  const openMarker = '<' + tagName
  const closeMarker = '</' + tagName + '>'
  let i = from
  let depth = 1
  const n = source.length
  while (i < n) {
    if (source.startsWith(closeMarker, i)) {
      depth--
      if (depth === 0) return i
      i += closeMarker.length
    } else if (
      source.startsWith(openMarker, i) &&
      i + openMarker.length < n &&
      /[\s/>]/.test(source[i + openMarker.length]!)
    ) {
      depth++
      i += openMarker.length
    } else {
      i++
    }
  }
  return -1
}
```

- [ ] **Step 2.4: Run tests, confirm they pass**

Run: `pnpm vitest run packages/frontend/tests/mdx/parser.test.ts`

Expected: All tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add packages/frontend/src/components/mdx/parser.ts packages/frontend/tests/mdx/parser.test.ts
git commit -m "feat(frontend/mdx): add segment parser with streaming-tolerant whitelist"
```

---

## Task 3: Port the props parser (`props-parser.ts`) — TDD

**Files:**
- Create: `packages/frontend/src/components/mdx/props-parser.ts`
- Create: `packages/frontend/tests/mdx/props-parser.test.ts`

- [ ] **Step 3.1: Write the failing tests**

Create `packages/frontend/tests/mdx/props-parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseProps } from '@/components/mdx/props-parser'

describe('parseProps', () => {
  it('returns empty object for empty input', () => {
    expect(parseProps('')).toEqual({ ok: true, value: {} })
  })

  it('parses a single string prop', () => {
    expect(parseProps('send="hello"')).toEqual({
      ok: true,
      value: { send: 'hello' },
    })
  })

  it('parses a JSON-escaped string', () => {
    expect(parseProps('send="a\\"b"')).toEqual({
      ok: true,
      value: { send: 'a"b' },
    })
  })

  it('parses a JSON expression prop', () => {
    expect(parseProps('columns={["a","b"]}')).toEqual({
      ok: true,
      value: { columns: ['a', 'b'] },
    })
  })

  it('parses mixed string + JSON props', () => {
    expect(parseProps('title="x" data={[{"a":1}]}')).toEqual({
      ok: true,
      value: { title: 'x', data: [{ a: 1 }] },
    })
  })

  it('returns ok:false for an unterminated string', () => {
    expect(parseProps('send="abc')).toMatchObject({ ok: false })
  })

  it('returns ok:false for unbalanced braces', () => {
    expect(parseProps('data={[1,2}')).toMatchObject({ ok: false })
  })

  it('returns ok:false for missing equals', () => {
    expect(parseProps('send "x"')).toMatchObject({ ok: false })
  })

  it('returns ok:false for invalid JSON in braces', () => {
    expect(parseProps('data={[1,2,]}')).toMatchObject({ ok: false })
  })
})
```

- [ ] **Step 3.2: Run tests, confirm they fail**

Run: `pnpm vitest run packages/frontend/tests/mdx/props-parser.test.ts`

Expected: All tests fail with `Failed to resolve import "@/components/mdx/props-parser"`.

- [ ] **Step 3.3: Implement `props-parser.ts`**

Create `packages/frontend/src/components/mdx/props-parser.ts`:

```ts
export type ParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: string }

/**
 * Parse the prop string from an MDX component opening tag.
 * Grammar: zero or more `name="string"` | `name={json-value}` separated by whitespace.
 * Strings use double quotes only. JSON values are parsed by JSON.parse after braces stripped.
 */
export function parseProps(raw: string): ParseResult {
  const value: Record<string, unknown> = {}
  let i = 0
  const n = raw.length

  const skipWs = () => {
    while (i < n && /\s/.test(raw[i]!)) i++
  }

  while (true) {
    skipWs()
    if (i >= n) return { ok: true, value }

    const idStart = i
    if (!/[A-Za-z_$]/.test(raw[i]!)) {
      return { ok: false, reason: `expected prop name at ${i}` }
    }
    i++
    while (i < n && /[\w$]/.test(raw[i]!)) i++
    const name = raw.slice(idStart, i)

    if (raw[i] !== '=') {
      return { ok: false, reason: `expected '=' after '${name}' at ${i}` }
    }
    i++

    if (raw[i] === '"') {
      const sStart = i
      i++
      while (i < n && raw[i] !== '"') {
        if (raw[i] === '\\' && i + 1 < n) i += 2
        else i++
      }
      if (i >= n) {
        return { ok: false, reason: `unterminated string for prop '${name}'` }
      }
      i++
      try {
        value[name] = JSON.parse(raw.slice(sStart, i))
      } catch (err) {
        return { ok: false, reason: `invalid string for '${name}': ${(err as Error).message}` }
      }
    } else if (raw[i] === '{') {
      const eStart = i + 1
      let depth = 1
      let j = i + 1
      while (j < n && depth > 0) {
        const c = raw[j]
        if (c === '"') {
          j++
          while (j < n && raw[j] !== '"') {
            if (raw[j] === '\\' && j + 1 < n) j += 2
            else j++
          }
          if (j >= n) return { ok: false, reason: `unterminated string inside braces for '${name}'` }
          j++
        } else if (c === '{') {
          depth++
          j++
        } else if (c === '}') {
          depth--
          j++
        } else {
          j++
        }
      }
      if (depth !== 0) {
        return { ok: false, reason: `unbalanced braces for prop '${name}'` }
      }
      const expr = raw.slice(eStart, j - 1)
      try {
        value[name] = JSON.parse(expr)
      } catch (err) {
        return { ok: false, reason: `invalid JSON for prop '${name}': ${(err as Error).message}` }
      }
      i = j
    } else {
      return { ok: false, reason: `expected '"' or '{' after '=' for prop '${name}' at ${i}` }
    }
  }
}
```

- [ ] **Step 3.4: Run tests, confirm they pass**

Run: `pnpm vitest run packages/frontend/tests/mdx/props-parser.test.ts`

Expected: All tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add packages/frontend/src/components/mdx/props-parser.ts packages/frontend/tests/mdx/props-parser.test.ts
git commit -m "feat(frontend/mdx): add JSX-style props parser"
```

---

## Task 4: Conversation context

A tiny React context so `<Button>` can call `sendMessage` against the surrounding conversation.

**Files:**
- Create: `packages/frontend/src/components/mdx/conversation-context.ts`

- [ ] **Step 4.1: Create the file**

```ts
import { createContext, useContext, type ReactNode, createElement } from 'react'

interface MdxConversationValue {
  conversationId: string
}

const MdxConversationContext = createContext<MdxConversationValue | null>(null)

export function MdxConversationProvider({
  value,
  children,
}: {
  value: MdxConversationValue
  children: ReactNode
}) {
  return createElement(MdxConversationContext.Provider, { value }, children)
}

export function useMdxConversation(): MdxConversationValue {
  const v = useContext(MdxConversationContext)
  if (!v) throw new Error('useMdxConversation must be used inside <MdxConversationProvider>')
  return v
}
```

- [ ] **Step 4.2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`

Expected: No errors.

- [ ] **Step 4.3: Commit**

```bash
git add packages/frontend/src/components/mdx/conversation-context.ts
git commit -m "feat(frontend/mdx): add conversation context for inline components"
```

---

## Task 5: Markdown wrapper around Streamdown

A thin component that wraps Streamdown with our streaming mode + allowed-tags config. Sanitization is handled by Streamdown's built-in `rehype-harden` + `rehype-sanitize`.

**Files:**
- Create: `packages/frontend/src/components/mdx/markdown.tsx`
- Create: `packages/frontend/tests/mdx/markdown.test.tsx`

- [ ] **Step 5.1: Write the failing test**

Create `packages/frontend/tests/mdx/markdown.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MdxMarkdown } from '@/components/mdx/markdown'

describe('MdxMarkdown', () => {
  it('renders markdown bold', () => {
    const { container } = render(<MdxMarkdown source="hello **world**" />)
    expect(container.querySelector('strong')?.textContent).toBe('world')
  })

  it('renders fenced code', () => {
    const { container } = render(<MdxMarkdown source={'```\nfoo\n```'} />)
    expect(container.querySelector('code')?.textContent).toContain('foo')
  })

  it('strips <script> from inline HTML', () => {
    const { container } = render(
      <MdxMarkdown source={'a <script>alert(1)</script> b'} />,
    )
    expect(container.querySelector('script')).toBeNull()
  })

  it('strips javascript: URLs from links', () => {
    const { container } = render(
      <MdxMarkdown source={'[click](javascript:alert(1))'} />,
    )
    const a = container.querySelector('a')
    expect(a?.getAttribute('href')).not.toMatch(/^javascript:/i)
  })
})
```

- [ ] **Step 5.2: Run, confirm it fails**

Run: `pnpm vitest run packages/frontend/tests/mdx/markdown.test.tsx`

Expected: Fails with `Failed to resolve import "@/components/mdx/markdown"`.

- [ ] **Step 5.3: Implement `markdown.tsx`**

Create `packages/frontend/src/components/mdx/markdown.tsx`:

```tsx
import { memo } from 'react'
import { Streamdown } from 'streamdown'
import { cn } from '@/lib/utils'

interface MdxMarkdownProps {
  source: string
  className?: string
}

/**
 * Thin wrapper around Streamdown. Streamdown bundles rehype-harden and
 * rehype-sanitize with safe defaults; <script>, on* handlers, and
 * javascript: URLs are stripped automatically. We pass mode="streaming"
 * so partial fences and tags don't tear during chunked rendering.
 */
export const MdxMarkdown = memo(function MdxMarkdown({ source, className }: MdxMarkdownProps) {
  return (
    <div className={cn('mdx-markdown text-[15.5px] leading-[1.68] text-foreground', className)}>
      <Streamdown
        mode='streaming'
        parseIncompleteMarkdown
      >
        {source}
      </Streamdown>
    </div>
  )
})
```

- [ ] **Step 5.4: Run tests, confirm they pass**

Run: `pnpm vitest run packages/frontend/tests/mdx/markdown.test.tsx`

Expected: All four tests pass. If the `javascript:` URL test fails, Streamdown's default `urlTransform` may need to be re-applied — confirm `defaultUrlTransform` is the default behavior by reading [the Streamdown docs](https://streamdown.ai) in the project's installed `node_modules/streamdown/README.md`. If still failing, add `urlTransform={defaultUrlTransform}` explicitly (import from `streamdown`).

- [ ] **Step 5.5: Commit**

```bash
git add packages/frontend/src/components/mdx/markdown.tsx packages/frontend/tests/mdx/markdown.test.tsx
git commit -m "feat(frontend/mdx): wrap Streamdown for streaming-safe markdown"
```

---

## Task 6: `<Buttons>` and `<Button>` components — TDD

`Buttons` is layout-only. `Button` posts the `send` string to the conversation on click.

**Files:**
- Create: `packages/frontend/src/components/mdx/components/Buttons.tsx`
- Create: `packages/frontend/src/components/mdx/components/Button.tsx`
- Create: `packages/frontend/tests/mdx/components/Button.test.tsx`

- [ ] **Step 6.1: Write the failing test**

Create `packages/frontend/tests/mdx/components/Button.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button as MdxButton } from '@/components/mdx/components/Button'
import { Buttons as MdxButtons } from '@/components/mdx/components/Buttons'
import { MdxConversationProvider } from '@/components/mdx/conversation-context'

vi.mock('@/api', () => ({
  sendMessage: vi.fn().mockResolvedValue({ msgId: 'm1', messageId: 'id1' }),
}))

import { sendMessage } from '@/api'

function renderInContext(node: React.ReactNode) {
  return render(
    <MdxConversationProvider value={{ conversationId: 'conv-1' }}>
      {node}
    </MdxConversationProvider>,
  )
}

beforeEach(() => {
  vi.mocked(sendMessage).mockClear()
})

describe('<Buttons>', () => {
  it('renders children in a row container', () => {
    const { container } = renderInContext(
      <MdxButtons>
        <MdxButton send='a'>A</MdxButton>
        <MdxButton send='b'>B</MdxButton>
      </MdxButtons>,
    )
    expect(container.querySelectorAll('button')).toHaveLength(2)
  })
})

describe('<Button>', () => {
  it('calls sendMessage with conversationId and send payload on click', async () => {
    renderInContext(<MdxButton send='approve plan'>Approve</MdxButton>)
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(sendMessage).toHaveBeenCalledWith('conv-1', 'approve plan')
  })

  it('disables after successful send', async () => {
    renderInContext(<MdxButton send='ok'>OK</MdxButton>)
    const btn = screen.getByRole('button', { name: 'OK' })
    await userEvent.click(btn)
    expect(btn).toBeDisabled()
  })

  it('shows an inline error on failure', async () => {
    vi.mocked(sendMessage).mockRejectedValueOnce(new Error('boom'))
    renderInContext(<MdxButton send='ok'>OK</MdxButton>)
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(await screen.findByText(/boom/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 6.2: Run, confirm it fails**

Run: `pnpm vitest run packages/frontend/tests/mdx/components/Button.test.tsx`

Expected: Fails with module resolution errors.

- [ ] **Step 6.3: Implement `Buttons.tsx`**

Create `packages/frontend/src/components/mdx/components/Buttons.tsx`:

```tsx
import type { ReactNode } from 'react'

export function Buttons({ children }: { children?: ReactNode }) {
  return <div className='mt-3 flex flex-wrap gap-2'>{children}</div>
}
```

- [ ] **Step 6.4: Implement `Button.tsx`**

Create `packages/frontend/src/components/mdx/components/Button.tsx`:

```tsx
import { useState, type ReactNode } from 'react'
import { Button as UiButton } from '@/components/ui/button'
import { sendMessage } from '@/api'
import { useMdxConversation } from '../conversation-context'
import { cn } from '@/lib/utils'

export interface MdxButtonProps {
  send: string
  style?: 'primary' | 'secondary' | 'danger'
  children?: ReactNode
}

const VARIANT_MAP = {
  primary: 'default',
  secondary: 'secondary',
  danger: 'destructive',
} as const

export function Button({ send, style = 'primary', children }: MdxButtonProps) {
  const { conversationId } = useMdxConversation()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    setBusy(true)
    setError(null)
    try {
      await sendMessage(conversationId, send)
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='flex flex-col gap-1'>
      <UiButton
        size='sm'
        variant={VARIANT_MAP[style]}
        disabled={busy || done}
        onClick={onClick}
        className={cn(style === 'primary' && 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]')}
      >
        {children}
      </UiButton>
      {error && (
        <span className='font-mono text-[11px] text-destructive'>{error}</span>
      )}
    </div>
  )
}
```

- [ ] **Step 6.5: Run tests, confirm they pass**

Run: `pnpm vitest run packages/frontend/tests/mdx/components/Button.test.tsx`

Expected: All four tests pass.

- [ ] **Step 6.6: Commit**

```bash
git add packages/frontend/src/components/mdx/components/Button.tsx packages/frontend/src/components/mdx/components/Buttons.tsx packages/frontend/tests/mdx/components/Button.test.tsx
git commit -m "feat(frontend/mdx): add inline <Buttons>/<Button> with sendMessage wiring"
```

---

## Task 7: `<DataTable>` component — TDD

**Files:**
- Create: `packages/frontend/src/components/mdx/components/DataTable.tsx`
- Create: `packages/frontend/tests/mdx/components/DataTable.test.tsx`

- [ ] **Step 7.1: Write the failing test**

Create `packages/frontend/tests/mdx/components/DataTable.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DataTable } from '@/components/mdx/components/DataTable'

describe('<DataTable>', () => {
  it('renders headers and rows', () => {
    render(<DataTable columns={['A', 'B']} rows={[[1, 'x'], [2, 'y']]} />)
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('y')).toBeInTheDocument()
  })

  it('renders null cells as a dash', () => {
    render(<DataTable columns={['X']} rows={[[null]]} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders nothing when rows is empty', () => {
    const { container } = render(<DataTable columns={['X']} rows={[]} />)
    expect(container.querySelector('table')).toBeNull()
  })
})
```

- [ ] **Step 7.2: Run, confirm it fails**

Run: `pnpm vitest run packages/frontend/tests/mdx/components/DataTable.test.tsx`

Expected: import error.

- [ ] **Step 7.3: Implement `DataTable.tsx`**

```tsx
export interface DataTableProps {
  columns: string[]
  rows: Array<Array<string | number | boolean | null>>
}

export function DataTable({ columns, rows }: DataTableProps) {
  if (!Array.isArray(rows) || rows.length === 0) return null
  return (
    <div className='my-3 overflow-x-auto rounded-md border border-border bg-card'>
      <table className='w-full border-collapse text-[13px]'>
        <thead>
          <tr className='border-b border-border bg-muted/50'>
            {columns.map((c) => (
              <th
                key={c}
                className='px-3 py-2 text-left font-mono text-[11.5px] font-medium tracking-[-0.005em] text-muted-foreground'
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className='border-b border-border last:border-b-0'>
              {row.map((cell, ci) => (
                <td key={ci} className='px-3 py-2 font-mono tabular-nums text-foreground'>
                  {cell === null ? '—' : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 7.4: Run tests, confirm they pass**

Run: `pnpm vitest run packages/frontend/tests/mdx/components/DataTable.test.tsx`

Expected: All three tests pass.

- [ ] **Step 7.5: Commit**

```bash
git add packages/frontend/src/components/mdx/components/DataTable.tsx packages/frontend/tests/mdx/components/DataTable.test.tsx
git commit -m "feat(frontend/mdx): add <DataTable>"
```

---

## Task 8: `<KeyValueList>` component — TDD

**Files:**
- Create: `packages/frontend/src/components/mdx/components/KeyValueList.tsx`
- Create: `packages/frontend/tests/mdx/components/KeyValueList.test.tsx`

- [ ] **Step 8.1: Write the failing test**

Create `packages/frontend/tests/mdx/components/KeyValueList.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KeyValueList } from '@/components/mdx/components/KeyValueList'

describe('<KeyValueList>', () => {
  it('renders key/value pairs in document order', () => {
    render(<KeyValueList items={{ followers: 12000, region: 'US', verified: true }} />)
    expect(screen.getByText('followers')).toBeInTheDocument()
    expect(screen.getByText('12000')).toBeInTheDocument()
    expect(screen.getByText('region')).toBeInTheDocument()
    expect(screen.getByText('US')).toBeInTheDocument()
    expect(screen.getByText('verified')).toBeInTheDocument()
    expect(screen.getByText('true')).toBeInTheDocument()
  })

  it('renders null as a dash', () => {
    render(<KeyValueList items={{ foo: null }} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders nothing for an empty object', () => {
    const { container } = render(<KeyValueList items={{}} />)
    expect(container.querySelector('dl')).toBeNull()
  })
})
```

- [ ] **Step 8.2: Run, confirm it fails**

Run: `pnpm vitest run packages/frontend/tests/mdx/components/KeyValueList.test.tsx`

Expected: import error.

- [ ] **Step 8.3: Implement `KeyValueList.tsx`**

```tsx
export interface KeyValueListProps {
  items: Record<string, string | number | boolean | null>
}

export function KeyValueList({ items }: KeyValueListProps) {
  const entries = Object.entries(items)
  if (entries.length === 0) return null
  return (
    <dl className='my-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-border bg-card px-3 py-2.5 text-[13px]'>
      {entries.map(([k, v]) => (
        <div key={k} className='contents'>
          <dt className='font-mono text-[11.5px] uppercase tracking-[0.06em] text-muted-foreground'>
            {k}
          </dt>
          <dd className='m-0 font-mono tabular-nums text-foreground'>
            {v === null ? '—' : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  )
}
```

- [ ] **Step 8.4: Run tests, confirm they pass**

Run: `pnpm vitest run packages/frontend/tests/mdx/components/KeyValueList.test.tsx`

Expected: All three tests pass.

- [ ] **Step 8.5: Commit**

```bash
git add packages/frontend/src/components/mdx/components/KeyValueList.tsx packages/frontend/tests/mdx/components/KeyValueList.test.tsx
git commit -m "feat(frontend/mdx): add <KeyValueList>"
```

---

## Task 9: `<LineChart>` component — TDD

A hand-rolled SVG line chart with grid, axes, and points. Single series. No legend.

**Files:**
- Create: `packages/frontend/src/components/mdx/components/LineChart.tsx`
- Create: `packages/frontend/tests/mdx/components/LineChart.test.tsx`

- [ ] **Step 9.1: Write the failing test**

Create `packages/frontend/tests/mdx/components/LineChart.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LineChart } from '@/components/mdx/components/LineChart'

const DATA = [
  { day: 'Mon', likes: 100 },
  { day: 'Tue', likes: 240 },
  { day: 'Wed', likes: 180 },
  { day: 'Thu', likes: 320 },
]

describe('<LineChart>', () => {
  it('renders an svg with a polyline for the data', () => {
    const { container } = render(<LineChart data={DATA} xKey='day' yKey='likes' />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    const polyline = container.querySelector('polyline')
    expect(polyline).not.toBeNull()
    expect(polyline!.getAttribute('points')!.split(' ')).toHaveLength(DATA.length)
  })

  it('renders the title when provided', () => {
    render(<LineChart data={DATA} xKey='day' yKey='likes' title='Likes per day' />)
    expect(screen.getByText('Likes per day')).toBeInTheDocument()
  })

  it('renders an empty-state message when data is empty', () => {
    render(<LineChart data={[]} xKey='day' yKey='likes' />)
    expect(screen.getByText(/no data/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 9.2: Run, confirm it fails**

Run: `pnpm vitest run packages/frontend/tests/mdx/components/LineChart.test.tsx`

Expected: import error.

- [ ] **Step 9.3: Implement `LineChart.tsx`**

```tsx
export interface LineChartProps {
  data: Array<Record<string, unknown>>
  xKey: string
  yKey: string
  title?: string
}

const W = 480
const H = 220
const PAD_L = 36
const PAD_R = 12
const PAD_T = 12
const PAD_B = 28
const GRID = 4

export function LineChart({ data, xKey, yKey, title }: LineChartProps) {
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <div className='my-3 rounded-md border border-border bg-card px-3 py-3 text-[12px] text-muted-foreground'>
        No data
      </div>
    )
  }

  const ys = data.map((d) => Number(d[yKey]) || 0)
  const yMin = Math.min(...ys, 0)
  const yMax = Math.max(...ys, yMin + 1)

  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0

  function px(i: number): number {
    return PAD_L + i * stepX
  }
  function py(v: number): number {
    const t = (v - yMin) / (yMax - yMin || 1)
    return PAD_T + innerH - t * innerH
  }

  const points = data.map((_, i) => `${px(i)},${py(ys[i]!)}`).join(' ')
  const gridLines = Array.from({ length: GRID + 1 }, (_, i) => {
    const y = PAD_T + (innerH * i) / GRID
    const v = yMax - ((yMax - yMin) * i) / GRID
    return { y, v }
  })

  return (
    <div className='my-3 rounded-md border border-border bg-card p-3'>
      {title && (
        <div className='mb-2 font-mono text-[11.5px] uppercase tracking-[0.06em] text-muted-foreground'>
          {title}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className='block h-auto w-full'>
        {gridLines.map((g, i) => (
          <g key={i}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={g.y}
              y2={g.y}
              stroke='currentColor'
              strokeOpacity={0.08}
              strokeWidth={1}
            />
            <text
              x={PAD_L - 6}
              y={g.y + 3}
              textAnchor='end'
              fontSize={10}
              fontFamily='var(--font-mono, monospace)'
              fill='currentColor'
              fillOpacity={0.55}
            >
              {formatTick(g.v)}
            </text>
          </g>
        ))}
        {data.map((d, i) => (
          <text
            key={i}
            x={px(i)}
            y={H - 8}
            textAnchor='middle'
            fontSize={10}
            fontFamily='var(--font-mono, monospace)'
            fill='currentColor'
            fillOpacity={0.55}
          >
            {String(d[xKey] ?? '')}
          </text>
        ))}
        <polyline
          points={points}
          fill='none'
          stroke='var(--anubis-gold, currentColor)'
          strokeWidth={2}
          strokeLinejoin='round'
          strokeLinecap='round'
        />
        {data.map((_, i) => (
          <circle
            key={i}
            cx={px(i)}
            cy={py(ys[i]!)}
            r={2.5}
            fill='var(--anubis-gold, currentColor)'
          />
        ))}
      </svg>
    </div>
  )
}

function formatTick(n: number): string {
  if (!Number.isFinite(n)) return ''
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
```

- [ ] **Step 9.4: Run tests, confirm they pass**

Run: `pnpm vitest run packages/frontend/tests/mdx/components/LineChart.test.tsx`

Expected: All three tests pass.

- [ ] **Step 9.5: Commit**

```bash
git add packages/frontend/src/components/mdx/components/LineChart.tsx packages/frontend/tests/mdx/components/LineChart.test.tsx
git commit -m "feat(frontend/mdx): add <LineChart> (hand-rolled SVG, no recharts)"
```

---

## Task 10: `<MdxContent>` entry — wires parser + components + markdown

The entry component splits the source, wraps it in the conversation context, and renders each segment.

**Files:**
- Create: `packages/frontend/src/components/mdx/index.tsx`
- Create: `packages/frontend/tests/mdx/index.test.tsx`

- [ ] **Step 10.1: Write the failing test**

Create `packages/frontend/tests/mdx/index.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MdxContent } from '@/components/mdx'

vi.mock('@/api', () => ({
  sendMessage: vi.fn().mockResolvedValue({ msgId: 'm1', messageId: 'id1' }),
}))

describe('<MdxContent>', () => {
  it('renders interleaved markdown and components', () => {
    const source = [
      'Here are some options:',
      '',
      '<Buttons><Button send="yes">Yes</Button><Button send="no" style="danger">No</Button></Buttons>',
      '',
      'And data:',
      '',
      '<KeyValueList items={{"followers":120,"region":"ID"}} />',
    ].join('\n')

    render(<MdxContent source={source} conversationId='c1' />)

    expect(screen.getByText(/Here are some options/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument()
    expect(screen.getByText('followers')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
  })

  it('falls back to a <pre> when a component has malformed props', () => {
    const { container } = render(
      <MdxContent source={'<DataTable columns={[1,2,}/>'} conversationId='c1' />,
    )
    expect(container.querySelector('pre')).not.toBeNull()
  })

  it('renders an unclosed whitelisted tag at end of input as plain text (streaming-safe)', () => {
    const { container } = render(
      <MdxContent source={'leading text <Buttons><Button send="hi'} conversationId='c1' />,
    )
    // No real button rendered yet — it's still streaming markdown.
    expect(container.querySelector('button')).toBeNull()
    expect(screen.getByText(/leading text/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 10.2: Run, confirm it fails**

Run: `pnpm vitest run packages/frontend/tests/mdx/index.test.tsx`

Expected: import error.

- [ ] **Step 10.3: Implement `index.tsx`**

```tsx
import { Fragment, useMemo } from 'react'
import { splitMdxSource, type Segment, type ComponentName } from './parser'
import { parseProps } from './props-parser'
import { MdxConversationProvider } from './conversation-context'
import { MdxMarkdown } from './markdown'
import { Buttons } from './components/Buttons'
import { Button } from './components/Button'
import { DataTable } from './components/DataTable'
import { KeyValueList } from './components/KeyValueList'
import { LineChart } from './components/LineChart'

export interface MdxContentProps {
  source: string
  conversationId: string
}

export function MdxContent({ source, conversationId }: MdxContentProps) {
  const segments = useMemo(() => splitMdxSource(source), [source])

  return (
    <MdxConversationProvider value={{ conversationId }}>
      <div className='flex flex-col gap-2'>
        {segments.map((seg, i) => (
          <Fragment key={i}>{renderSegment(seg)}</Fragment>
        ))}
      </div>
    </MdxConversationProvider>
  )
}

function renderSegment(seg: Segment) {
  if (seg.kind === 'markdown') {
    if (!seg.text.trim()) return null
    return <MdxMarkdown source={seg.text} />
  }
  return <ComponentSegment name={seg.name} propsRaw={seg.propsRaw} childrenRaw={seg.childrenRaw} />
}

function ComponentSegment({
  name,
  propsRaw,
  childrenRaw,
}: {
  name: ComponentName
  propsRaw: string
  childrenRaw: string
}) {
  const parsed = parseProps(propsRaw)
  if (!parsed.ok) {
    return <Fallback raw={`<${name} ${propsRaw}>`} reason={parsed.reason} />
  }
  const props = parsed.value as Record<string, unknown>

  switch (name) {
    case 'Buttons':
      return (
        <Buttons>
          {splitMdxSource(childrenRaw).map((sub, i) => (
            <Fragment key={i}>{renderSegment(sub)}</Fragment>
          ))}
        </Buttons>
      )
    case 'Button': {
      const label = childrenRaw.trim()
      return (
        <Button
          send={String(props.send ?? '')}
          style={props.style as 'primary' | 'secondary' | 'danger' | undefined}
        >
          {label}
        </Button>
      )
    }
    case 'DataTable':
      return (
        <DataTable
          columns={(props.columns as string[]) ?? []}
          rows={(props.rows as Array<Array<string | number | boolean | null>>) ?? []}
        />
      )
    case 'KeyValueList':
      return (
        <KeyValueList
          items={(props.items as Record<string, string | number | boolean | null>) ?? {}}
        />
      )
    case 'LineChart':
      return (
        <LineChart
          data={(props.data as Array<Record<string, unknown>>) ?? []}
          xKey={String(props.xKey ?? '')}
          yKey={String(props.yKey ?? '')}
          title={typeof props.title === 'string' ? props.title : undefined}
        />
      )
    default:
      return <Fallback raw={`<${String(name)} />`} />
  }
}

function Fallback({ raw, reason }: { raw: string; reason?: string }) {
  return (
    <pre className='my-2 overflow-x-auto rounded-md bg-muted p-2 font-mono text-[11px] text-muted-foreground'>
      <code>
        Could not render component{reason ? ` (${reason})` : ''}:{'\n'}
        {raw}
      </code>
    </pre>
  )
}
```

- [ ] **Step 10.4: Run tests, confirm they pass**

Run: `pnpm vitest run packages/frontend/tests/mdx/index.test.tsx`

Expected: All three tests pass.

- [ ] **Step 10.5: Run the full MDX test suite**

Run: `pnpm vitest run packages/frontend/tests/mdx`

Expected: All MDX tests pass (parser + props-parser + markdown + four component suites + index).

- [ ] **Step 10.6: Commit**

```bash
git add packages/frontend/src/components/mdx/index.tsx packages/frontend/tests/mdx/index.test.tsx
git commit -m "feat(frontend/mdx): add MdxContent entry component"
```

---

## Task 11: SSE hook — `useConversationMessages`

Live subscription to `/conversations/:id/stream`. Seeds from `listMessages`, accumulates `partial.deltaText` into a synthetic streaming message, tracks tool events ordered alongside text fragments, and finalizes on `done`.

**Files:**
- Create: `packages/frontend/src/lib/conversation-stream.ts`

(No unit test — verified manually against the live backend in Task 13.)

- [ ] **Step 11.1: Create the hook**

```ts
import { useEffect, useRef, useState } from 'react'
import type { MessageSummary } from '@anubis/shared'
import { getApiBaseUrl, listMessages } from '@/api'

export type ToolEvent =
  | { kind: 'call'; callId: string; name: string; args: unknown }
  | { kind: 'result'; callId: string; name: string; result: unknown }

export type Fragment =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; callId: string }

export interface LiveAssistantMessage {
  id: string
  role: 'assistant'
  fragments: Fragment[]
  toolEvents: Record<string, ToolEvent>
  startedAt: number
}

export interface ConversationStreamState {
  messages: MessageSummary[]
  streaming: LiveAssistantMessage | null
  error: string | null
  chunks: number
  partialChars: number
}

export function useConversationMessages(conversationId: string | undefined): ConversationStreamState {
  const [messages, setMessages] = useState<MessageSummary[]>([])
  const [streaming, setStreaming] = useState<LiveAssistantMessage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chunks, setChunks] = useState(0)
  const [partialChars, setPartialChars] = useState(0)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!conversationId) return
    let cancelled = false

    listMessages(conversationId)
      .then((items) => {
        if (!cancelled) setMessages(items)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })

    let es: EventSource | null = null
    void getApiBaseUrl().then((baseUrl) => {
      if (cancelled) return
      const url = new URL(`/conversations/${encodeURIComponent(conversationId)}/stream`, baseUrl)
      es = new EventSource(url.toString())
      esRef.current = es

      const ensureStreaming = (): LiveAssistantMessage => ({
        id: `streaming:${Date.now()}`,
        role: 'assistant',
        fragments: [],
        toolEvents: {},
        startedAt: Date.now(),
      })

      es.addEventListener('partial', (raw) => {
        const data = parseSse<{ deltaText: string }>(raw)
        if (!data) return
        setChunks((c) => c + 1)
        setPartialChars((p) => p + data.deltaText.length)
        setStreaming((cur) => {
          const next = cur ?? ensureStreaming()
          const last = next.fragments[next.fragments.length - 1]
          if (last && last.kind === 'text') {
            return {
              ...next,
              fragments: [
                ...next.fragments.slice(0, -1),
                { kind: 'text', text: last.text + data.deltaText },
              ],
            }
          }
          return { ...next, fragments: [...next.fragments, { kind: 'text', text: data.deltaText }] }
        })
      })

      es.addEventListener('tool_call', (raw) => {
        const data = parseSse<{ callId: string; name: string; args: unknown }>(raw)
        if (!data) return
        setStreaming((cur) => {
          const next = cur ?? ensureStreaming()
          return {
            ...next,
            fragments: [...next.fragments, { kind: 'tool', callId: data.callId }],
            toolEvents: {
              ...next.toolEvents,
              [data.callId]: { kind: 'call', callId: data.callId, name: data.name, args: data.args },
            },
          }
        })
      })

      es.addEventListener('tool_result', (raw) => {
        const data = parseSse<{ callId: string; name: string; result: unknown }>(raw)
        if (!data) return
        setStreaming((cur) => {
          if (!cur) return cur
          return {
            ...cur,
            toolEvents: {
              ...cur.toolEvents,
              [data.callId]: { kind: 'result', callId: data.callId, name: data.name, result: data.result },
            },
          }
        })
      })

      es.addEventListener('system', (raw) => {
        const data = parseSse<{ content: string }>(raw)
        if (!data) return
        setMessages((m) => [
          ...m,
          {
            id: `system:${Date.now()}`,
            conversationId,
            msgId: `system:${Date.now()}`,
            role: 'system',
            content: data.content,
            createdAt: Date.now(),
          },
        ])
      })

      es.addEventListener('done', () => {
        setStreaming(null)
        listMessages(conversationId)
          .then((items) => {
            if (!cancelled) setMessages(items)
          })
          .catch(() => {})
        es?.close()
      })

      es.addEventListener('error', (raw) => {
        const data = parseSse<{ message?: string }>(raw)
        if (data?.message) setError(data.message)
      })

      es.addEventListener('approval_required', (raw) => {
        // Out of scope for the MDX rendering work — log for now.
        // eslint-disable-next-line no-console
        console.info('[anubis] approval_required (no UI yet):', raw.data)
      })
    })

    return () => {
      cancelled = true
      esRef.current?.close()
      esRef.current = null
    }
  }, [conversationId])

  return { messages, streaming, error, chunks, partialChars }
}

function parseSse<T>(raw: MessageEvent): T | null {
  try {
    return JSON.parse(raw.data) as T
  } catch {
    return null
  }
}
```

- [ ] **Step 11.2: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`

Expected: No errors. If TypeScript complains about `MessageEvent`, ensure the DOM lib is present in `tsconfig.json` (it already is — `lib: ["DOM", ...]`).

- [ ] **Step 11.3: Commit**

```bash
git add packages/frontend/src/lib/conversation-stream.ts
git commit -m "feat(frontend): SSE hook for live conversation messages"
```

---

## Task 12: Wire `active-conversation.tsx` to MDX + live SSE

Replace `RealMessages` with an MDX-rendering message list driven by the new hook. Delete the mock transcript (per spec). Replace the mock status-bar ticker with real counts.

**Files:**
- Modify: `packages/frontend/src/pages/active-conversation.tsx`

- [ ] **Step 12.1: Read the current file**

(Already in context from brainstorming. Reread if needed: `cat packages/frontend/src/pages/active-conversation.tsx`.)

- [ ] **Step 12.2: Rewrite `active-conversation.tsx`**

Replace the entire file contents with:

```tsx
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronDownIcon, GlobeIcon, PaperclipIcon, SendIcon, BrainIcon } from 'lucide-react'

import type { MessageSummary } from '@anubis/shared'

import { sendMessage as apiSendMessage } from '@/api'
import { cn } from '@/lib/utils'
import { AnubisMark } from '@/components/brand/anubis-mark'
import { useNavigation } from '@/lib/navigation'
import { MdxContent } from '@/components/mdx'
import {
  useConversationMessages,
  type Fragment as LiveFragment,
  type ToolEvent,
} from '@/lib/conversation-stream'

export function ActiveConversationPage({ conversationId }: { conversationId?: string }) {
  const { navigate } = useNavigation()
  const { messages, streaming, error, chunks, partialChars } =
    useConversationMessages(conversationId)
  const [elapsed, setElapsed] = useState(0)
  const [cancelled, setCancelled] = useState(false)

  useEffect(() => {
    if (!streaming || cancelled) return
    setElapsed(0)
    const start = streaming.startedAt
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }, 250)
    return () => clearInterval(tick)
  }, [streaming, cancelled])

  const tokens = Math.round(partialChars / 4)
  const isLive = !!streaming && !cancelled

  return (
    <div className='flex flex-1 flex-col overflow-hidden bg-background'>
      <div className='flex flex-shrink-0 items-start justify-between gap-5 border-b border-border px-7 pb-4 pt-[18px]'>
        <div>
          <h1 className='m-0 text-[25px] font-semibold leading-[1.15] tracking-[-0.022em]'>
            {conversationId ? 'Active conversation' : 'New conversation'}
          </h1>
          <div className='mt-2.5 flex flex-wrap items-center gap-3'>
            <span className='inline-flex h-[26px] items-center gap-1.5 rounded-full border border-border bg-card px-2.5 pl-2.5 font-mono text-[12px] text-foreground'>
              <span className='inline-block size-1.5 rounded-full bg-[var(--anubis-gold)]' />
              Claude · Coding (plan)
            </span>
            {conversationId && (
              <span className='font-mono text-[12px] text-muted-foreground/65'>
                session: {conversationId.slice(0, 13)}
              </span>
            )}
          </div>
        </div>
        <button
          type='button'
          onClick={() => setCancelled(true)}
          disabled={cancelled || !isLive}
          className={cn(
            'inline-flex h-[34px] items-center gap-[7px] rounded-md px-3.5 text-[14px] font-medium transition-colors',
            cancelled || !isLive
              ? 'text-muted-foreground opacity-50'
              : 'text-muted-foreground hover:bg-[color-mix(in_oklab,var(--destructive)_12%,transparent)] hover:text-destructive',
          )}
        >
          {cancelled ? 'Cancelled' : 'Cancel'}
        </button>
      </div>

      <div className='flex-1 overflow-y-auto px-7 pb-[30px] pt-[34px]'>
        <div className='mx-auto flex max-w-[720px] flex-col gap-6'>
          {messages.map((m) => (
            <RenderedMessage key={m.id} message={m} conversationId={conversationId ?? ''} />
          ))}
          {streaming && (
            <StreamingMessage live={streaming} conversationId={conversationId ?? ''} cancelled={cancelled} />
          )}
          {error && (
            <div className='rounded-md border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 font-mono text-[12px] text-destructive'>
              {error}
            </div>
          )}
        </div>
      </div>

      <Composer
        onSend={(content) => {
          if (!conversationId) {
            navigate({ page: 'conversations' })
            return
          }
          void apiSendMessage(conversationId, content)
        }}
        disabled={isLive}
      />

      <div className='flex flex-shrink-0 items-center justify-center gap-2 px-7 pb-3 pt-[7px] font-mono text-[11px] text-muted-foreground'>
        {cancelled ? (
          <span>Cancelled · {elapsed}s elapsed</span>
        ) : isLive ? (
          <>
            <span className='inline-block size-[7px] rounded-full bg-[var(--anubis-gold-hi)] animate-[anubisPulse_1.7s_ease-out_infinite]' />
            <span>
              Streaming · <span>{chunks}</span> chunks · <span>{(tokens / 1000).toFixed(1)}k</span>{' '}
              tokens · <span>{elapsed}</span>s elapsed
            </span>
          </>
        ) : (
          <span>Idle</span>
        )}
      </div>
    </div>
  )
}

function RenderedMessage({
  message,
  conversationId,
}: {
  message: MessageSummary
  conversationId: string
}) {
  if (message.role === 'user') {
    return (
      <div className='flex justify-end'>
        <div className='max-w-[75%] rounded-[13px] rounded-br-[4px] border border-border bg-card px-[15px] py-3 text-[15px] leading-[1.5] tracking-[-0.005em] text-foreground'>
          {message.content}
        </div>
      </div>
    )
  }
  if (message.role === 'system') {
    return (
      <div className='rounded-md border border-border bg-muted px-3.5 py-2.5 font-mono text-[12px] text-muted-foreground'>
        {message.content}
      </div>
    )
  }
  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center gap-2'>
        <AnubisMark size={15} />
        <span className='font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground'>
          Anubis
        </span>
      </div>
      <MdxContent source={message.content} conversationId={conversationId} />
    </div>
  )
}

function StreamingMessage({
  live,
  conversationId,
  cancelled,
}: {
  live: { fragments: LiveFragment[]; toolEvents: Record<string, ToolEvent> }
  conversationId: string
  cancelled: boolean
}) {
  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center gap-2'>
        <AnubisMark size={15} />
        <span className='font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground'>
          Anubis
        </span>
      </div>
      {live.fragments.map((frag, i) => {
        if (frag.kind === 'text') {
          return <MdxContent key={i} source={frag.text} conversationId={conversationId} />
        }
        const ev = live.toolEvents[frag.callId]
        if (!ev) return null
        return ev.kind === 'call' ? (
          <ToolCardRunning key={i} ev={ev} cancelled={cancelled} />
        ) : (
          <ToolCardSuccess key={i} ev={ev} />
        )
      })}
    </div>
  )
}

function ToolCardSuccess({ ev }: { ev: ToolEvent & { kind: 'result' } }) {
  return (
    <div className='relative max-w-[480px] overflow-hidden rounded-[10px] border border-border bg-card p-3'>
      <div className='flex items-center gap-2.5'>
        <span className='flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[var(--anubis-gold)]'>
          <GlobeIcon className='size-[15px]' strokeWidth={2} />
        </span>
        <div className='flex min-w-0 flex-1 flex-col'>
          <span className='truncate font-mono text-[12px] tracking-[-0.01em] text-foreground'>
            {ev.name}
          </span>
          <span className='mt-1 truncate font-mono text-[11.5px] text-muted-foreground'>
            completed
          </span>
        </div>
        <span className='size-[7px] rounded-full bg-[var(--anubis-success)]' />
      </div>
    </div>
  )
}

function ToolCardRunning({
  ev,
  cancelled,
}: {
  ev: ToolEvent & { kind: 'call' }
  cancelled: boolean
}) {
  return (
    <div className='relative max-w-[480px] overflow-hidden rounded-[10px] border border-border bg-card p-3'>
      <div className='flex items-center gap-2.5'>
        <span className='flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[var(--anubis-gold)]'>
          <BrainIcon className='size-[15px]' strokeWidth={2} />
        </span>
        <div className='flex min-w-0 flex-1 flex-col'>
          <span className='truncate font-mono text-[12px] tracking-[-0.01em] text-foreground'>
            {ev.name}
          </span>
          <span className='mt-1 truncate font-mono text-[11.5px] text-muted-foreground'>
            {cancelled ? 'cancelled' : 'running…'}
          </span>
        </div>
        <span
          className={cn(
            'size-[7px] rounded-full',
            cancelled
              ? 'bg-muted-foreground'
              : 'bg-[var(--anubis-gold-hi)] animate-[anubisPulse_1.7s_ease-out_infinite]',
          )}
        />
      </div>
      {!cancelled && (
        <div className='absolute inset-x-0 bottom-0 h-[2px] bg-[color-mix(in_oklab,var(--anubis-gold)_16%,transparent)]'>
          <div className='h-full w-[32%] animate-[anubisIndeterminate_1.7s_cubic-bezier(0.5,0.1,0.5,0.9)_infinite] rounded-sm bg-[var(--anubis-gold)]' />
        </div>
      )}
    </div>
  )
}

function Composer({ onSend, disabled }: { onSend: (content: string) => void; disabled: boolean }) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement | null>(null)

  function autoGrow() {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!value.trim()) return
    onSend(value)
    setValue('')
    if (ref.current) ref.current.style.height = 'auto'
  }

  return (
    <form
      onSubmit={submit}
      className='flex-shrink-0 border-t border-border px-7 pb-2.5 pt-3.5'
    >
      <div className='mx-auto flex max-w-[768px] items-center gap-2.5 rounded-[13px] border border-border bg-card py-[7px] pl-2.5 pr-2 focus-within:border-[color-mix(in_oklab,var(--anubis-gold)_45%,var(--border))]'>
        <button
          type='button'
          aria-label='Attach'
          className='flex size-[30px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <PaperclipIcon className='size-[17px]' strokeWidth={2} />
        </button>

        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            autoGrow()
          }}
          rows={1}
          placeholder='Reply to Anubis…'
          className='max-h-[120px] min-h-[24px] flex-1 resize-none bg-transparent px-1 py-2 text-[14.5px] leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground'
        />

        <button
          type='button'
          aria-label='Switch profile'
          className='inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 pl-2.5 font-mono text-[12px] text-foreground'
        >
          <span className='inline-block size-1.5 rounded-full bg-[var(--anubis-gold)]' />
          Claude · Coding
          <ChevronDownIcon className='size-3 text-muted-foreground' strokeWidth={2} />
        </button>

        <button
          type='submit'
          disabled={disabled || !value.trim()}
          className={cn(
            'inline-flex h-[34px] items-center gap-1.5 rounded-md px-4 text-[14px] font-semibold tracking-[-0.01em] transition-colors',
            disabled || !value.trim()
              ? 'cursor-not-allowed bg-[var(--anubis-gold)] text-[#0B0C0F] opacity-[0.42]'
              : 'bg-[var(--anubis-gold)] text-[#0B0C0F] hover:bg-[var(--anubis-gold-deep)]',
          )}
          title={disabled ? 'Send is disabled while a run is in progress' : undefined}
        >
          <SendIcon className='size-[14px]' strokeWidth={2} />
          Send
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 12.3: Typecheck**

Run: `pnpm --filter @anubis/frontend typecheck`

Expected: No errors. If anything complains about unused imports or unused params, clean them up minimally — don't add new logic.

- [ ] **Step 12.4: Run all frontend tests**

Run: `pnpm vitest run packages/frontend/tests`

Expected: All MDX tests still pass. (We did not add a test for the page wiring — it's verified manually.)

- [ ] **Step 12.5: Commit**

```bash
git add packages/frontend/src/pages/active-conversation.tsx
git commit -m "feat(frontend): live SSE + MDX rendering on active-conversation"
```

---

## Task 13: Final verification

- [ ] **Step 13.1: Repo-wide typecheck**

Run: `pnpm typecheck`

Expected: No TypeScript errors in any package.

- [ ] **Step 13.2: Repo-wide test run**

Run: `pnpm test`

Expected: All Vitest suites pass across `test/`, `packages/conversation/tests/`, `packages/backend/tests/`, and `packages/frontend/tests/`. No regressions.

- [ ] **Step 13.3: Build the frontend in isolation (catches Vite-only issues)**

Run: `pnpm --filter @anubis/frontend build`

Expected: Build succeeds, emits `packages/frontend/dist/`.

- [ ] **Step 13.4: Manual verification against the live backend**

Run: `pnpm dev`

Then in the running Electron app:

1. Create or open a conversation.
2. **Live streaming:** Send a message. Confirm assistant text appears progressively (not in one shot at the end). The status bar shows real chunks / tokens / elapsed.
3. **Markdown:** Confirm bold, italics, fenced code, lists, and tables in agent output all render styled.
4. **Sanitization:** From any code path that lets you craft an assistant message (e.g., seed the DB or use a test agent profile), include `<script>alert(1)</script>`. Confirm it renders as inert text — no alert fires.
5. **Component:** Craft an assistant message containing
   ```
   <Buttons><Button send="approved">Approve</Button><Button send="rejected" style="danger">Reject</Button></Buttons>
   ```
   Confirm two real buttons render. Click "Approve" — the string "approved" appears as a new user message in the transcript, and the button becomes disabled.
6. **DataTable:** Include `<DataTable columns={["day","likes"]} rows={[["Mon",100],["Tue",240]]} />`. Confirm a styled table renders.
7. **KeyValueList + LineChart:** Confirm both render with realistic props.
8. **Streaming-safe parser:** While a message streams in, watch that whitelisted tags never momentarily render as broken markup. The page should never show a half-parsed `<Buttons>` opening tag as raw text and then snap to a real button — the parser flushes the partial as markdown until the close tag arrives, which is invisible to the eye.

- [ ] **Step 13.5: Final commit (if any small fixes from manual QA)**

If manual QA surfaced issues, fix and commit. If not, skip this step.

```bash
git status
# if clean, no commit needed
```

- [ ] **Step 13.6: Summarize work in the chat**

Report back: which tasks landed, any deviations from the plan, any deferred follow-ups (e.g., persisting tool events for refresh-time reconstruction, approval UI).

---

## Acceptance criteria (from the spec, reaffirmed)

1. `pnpm dev` → MDX-rendered assistant messages with real markdown.
2. `<Buttons><Button send="…">` round-trips a user message via `sendMessage`.
3. `DataTable`, `KeyValueList`, `LineChart` all render with valid props.
4. Fresh agent run streams text + inline tool cards live.
5. `<script>` in an assistant message renders inert.
6. `pnpm typecheck` and `pnpm test` both pass.
