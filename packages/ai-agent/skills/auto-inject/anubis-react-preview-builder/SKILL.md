---
name: web-artifacts-builder
description: Deep-dive companion to the mdx-response skill for building elaborate, multi-component interactive React UIs that render live inside Anubis's <ReactPreview> sandbox (and <HtmlPreview> when you need CDN libraries). Read this when a single <DataTable>/<LineChart>/<KeyValueList> isn't enough — dashboards with state, tabs/views, reusable primitives, data fetched from the Anubis backend, or charts. NOT for claude.ai artifacts; Anubis has no bundler, no npm install, and no shadcn/ui.
when_to_use: When the user asks for an interactive dashboard, a multi-panel view, a stateful widget, a live data explorer, or any React UI richer than the single-purpose mdx-response components. The mdx-response skill covers the basics of <ReactPreview>/<HtmlPreview>; this skill is the runtime reference + patterns for the complex case.
---

# Anubis React Preview Builder

This skill builds complex front-ends for the **Anubis desktop chat**, not for
claude.ai. There is **no Vite, no Parcel, no `bundle.html`, no `npm install`,
no shadcn/ui, and no build step**. The only delivery channel is the
`<ReactPreview>` (and `<HtmlPreview>`) MDX component that the Anubis renderer
runs inside a sandboxed iframe. Read the `mdx-response` skill first for the
component basics — this skill is the runtime contract and the patterns for
anything beyond a single chart or table.

Source of truth for the runtime:
`packages/frontend/src/components/mdx/components/ReactPreview.tsx` and
`sandboxed-frame.tsx`.

## How `<ReactPreview>` actually runs

Everything you write goes between the tags as **one block of code** — the
children string. The renderer wraps it like this:

1. Loads **React 18.3.1 UMD**, **ReactDOM 18.3.1 UMD**, and
   **`@babel/standalone` 7.24.7** from a CDN inside the iframe.
2. Runs your code through
   `Babel.transform(src, { presets: [['react',{runtime:'classic'}], ['env',{targets:{esmodules:true}}]] })`
   and executes it with `new Function(...)`.
3. Mounts whatever you pass to `render(...)` into `#root`.

This shapes everything below.

### Hard constraints (read these before writing a line)

- **One file, no modules.** There is no `import`/`export`, no file system, no
  second component file. `import` compiles to `require()` and throws. Put every
  component, hook, helper, and constant in the single block.
- **Plain JSX/JS only — NO TypeScript.** The preset list is `react` + `env`,
  **not `typescript`**. Type annotations (`const x: number`, `interface`,
  `as const`, generics, `<T,>`) are a syntax error and surface as a red box.
  Write `.jsx`-style code.
- **No shadcn/ui, no Tailwind, no `@/` aliases, no Radix, no lucide-react.**
  None of those exist in the sandbox. Style with inline `style={{...}}` objects
  or a `<style>` element you render yourself (see Styling below).
- **No extra npm packages.** Only React + ReactDOM are present. For charts or
  other libraries you either hand-roll (small SVG) or drop to `<HtmlPreview>`
  with a CDN `<script>` (see "When to use HtmlPreview").
- **Mounting:** call `render(<App />)`. If you skip `render()` but define a
  top-level `function App() {...}`, it auto-mounts. Anything else shows
  "Nothing rendered."
- **Height:** auto-resizes to content, capped at 720px (override with
  `maxHeight={...}` on the tag, or fixed `height={...}`). Past the cap the
  frame scrolls internally — design dense dashboards to stay under it or accept
  internal scroll.
- **Errors** surface in a red `<pre>` box; `window.onerror` and
  `unhandledrejection` are wired up. A blank preview almost always means a
  thrown error or a missing `render()`.

### What's available as globals

- `React`, `ReactDOM`.
- Hook aliases already on `window`: `useState`, `useEffect`, `useMemo`,
  `useRef`, `useCallback`, `useReducer`. (Need `useContext`, `useLayoutEffect`,
  etc.? Reach through `React.useContext` — only the six above are pre-aliased.)
- `render(el)` — mounts into `#root`.
- `anubis.fetch(path, init)` — CORS-safe call to the Anubis backend, proxied
  through the parent window. Returns a Response-shaped object with `.ok`,
  `.status`, `.headers.get('content-type')`, `.json()`, `.text()`. Relative
  paths (`/competitors`) resolve against the running backend.
- `anubis.setHeight(px)` — manual height override (rarely needed; auto-resize
  is on).

### Base styling you inherit

The iframe ships a dark-first theme via CSS variables you can reuse:
`--fg` `#e6e7ea`, `--muted` `#9a9ba1`, `--border` `rgba(255,255,255,.10)`,
`--card` `rgba(255,255,255,.04)`, `--accent` `#d4a85c` (the Anubis gold).
`<button>` and `.card` already have sane defaults. Match this palette so the
preview feels native to the app — **don't** ship a white-background,
purple-gradient, Inter-font "AI slop" panel.

## Patterns for complex UIs

### Reusable primitives (your "mini shadcn")

Since shadcn isn't available, define a few small components at the top of the
block and reuse them. Drive them off the inherited CSS variables.

```jsx
const theme = {
  accent: '#d4a85c', fg: '#e6e7ea', muted: '#9a9ba1',
  border: 'rgba(255,255,255,.10)', card: 'rgba(255,255,255,.04)',
};

function Card({ title, children }) {
  return (
    <div style={{ border: `1px solid ${theme.border}`, background: theme.card,
                  borderRadius: 10, padding: 14 }}>
      {title && <div style={{ fontSize: 12, textTransform: 'uppercase',
                  letterSpacing: '.06em', color: theme.muted, marginBottom: 8 }}>{title}</div>}
      {children}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 26, fontWeight: 600, color: theme.fg }}>{value}</div>
      <div style={{ fontSize: 12, color: theme.muted }}>{label}</div>
    </div>
  );
}

function Pill({ children, tone = theme.accent }) {
  return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999,
    border: `1px solid ${tone}`, color: tone }}>{children}</span>;
}
```

### State, views, and "routing"

There is no router. Model navigation as state — a `view` string switched by
tab buttons, or `useReducer` for anything with several interdependent fields.

```jsx
function App() {
  const [view, setView] = useState('overview');
  return (
    <div>
      <nav style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {['overview', 'posts', 'trends'].map(v => (
          <button key={v} onClick={() => setView(v)}
            style={{ borderColor: view === v ? theme.accent : theme.border,
                     color: view === v ? theme.accent : theme.fg }}>{v}</button>
        ))}
      </nav>
      {view === 'overview' && <Overview />}
      {view === 'posts' && <Posts />}
      {view === 'trends' && <Trends />}
    </div>
  );
}
```

### Fetching live Anubis data

Use `anubis.fetch` inside `useEffect`, and always render loading + error +
empty states (the backend port is dynamic, so calls can fail). Endpoint shapes
live in the `anubis-core` skill folder (`competitors.md`, `crawler.md`,
`conversations.md`, `admin.md`).

```jsx
function useApi(path) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  useEffect(() => {
    let alive = true;
    anubis.fetch(path)
      .then(r => r.json())
      .then(d => alive && setState({ loading: false, error: null, data: d }))
      .catch(e => alive && setState({ loading: false, error: e.message, data: null }));
    return () => { alive = false; };
  }, [path]);
  return state;
}
```

### Charts without a chart library

For a small line/bar chart, hand-roll an SVG (no dependency, scales to the
theme). For anything heavier (Chart.js, Recharts, D3), don't fight the
sandbox — use `<HtmlPreview>` with a CDN script instead. If you only need a
single static series, the `mdx-response` `<LineChart>` component is simpler than
either preview — reach for it first.

## When to use `<HtmlPreview>` instead

Drop to `<HtmlPreview>` (raw HTML/CSS/JS) when you need things the React
sandbox can't give you cleanly:

- **A CDN library** — Chart.js, D3, ECharts, Tailwind Play CDN, Alpine, etc.
  In `<HtmlPreview>` you write the full document and can add `<script
  src="https://...">` tags. (`<ReactPreview>` can technically inject a script
  via `useEffect`, but it's fragile — prefer HtmlPreview.)
- **Utility-class styling** — load the Tailwind Play CDN in an `<HtmlPreview>`
  if you really want Tailwind; it is not available in `<ReactPreview>`.
- **Non-React widgets** — a canvas animation, a `<dialog>`, raw web components.

`<HtmlPreview>` gets the same `anubis.fetch` / `anubis.setHeight` runtime and
the same auto-resize. The `mdx-response` skill has `templates/dashboard.md`
and `templates/workflow.md` generator scripts for the two most common
HtmlPreview layouts — use those before writing dashboard HTML by hand.

## Pick the right tool

| Need | Use |
| --- | --- |
| Prose, code, a simple list | plain markdown |
| One table / one chart / one object's fields / a few action buttons | `mdx-response` components (`<DataTable>` `<LineChart>` `<KeyValueList>` `<Buttons>`) |
| Pre-baked KPI dashboard or workflow/DAG diagram | `mdx-response` dashboard / workflow generator scripts → `<HtmlPreview>` |
| Stateful, multi-component, interactive React (tabs, filters, live fetch) | **`<ReactPreview>` — this skill** |
| A CDN charting lib, Tailwind utility classes, canvas, or non-React widget | `<HtmlPreview>` (this skill, "When to use HtmlPreview") |

## Worked example — multi-tab competitor dashboard

A complete, self-contained `<ReactPreview>` that fetches `/competitors`,
switches views, reuses primitives, and stays on-theme. Paste-ready shape:

```mdx
<ReactPreview maxHeight={900}>
const theme = {
  accent: '#d4a85c', fg: '#e6e7ea', muted: '#9a9ba1',
  border: 'rgba(255,255,255,.10)', card: 'rgba(255,255,255,.04)',
};

function Card({ title, children }) {
  return (
    <div style={{ border: `1px solid ${theme.border}`, background: theme.card,
                  borderRadius: 10, padding: 14 }}>
      {title && <div style={{ fontSize: 12, textTransform: 'uppercase',
        letterSpacing: '.06em', color: theme.muted, marginBottom: 8 }}>{title}</div>}
      {children}
    </div>
  );
}

function useApi(path) {
  const [s, set] = useState({ loading: true, error: null, data: null });
  useEffect(() => {
    let alive = true;
    anubis.fetch(path).then(r => r.json())
      .then(d => alive && set({ loading: false, error: null, data: d }))
      .catch(e => alive && set({ loading: false, error: e.message, data: null }));
    return () => { alive = false; };
  }, [path]);
  return s;
}

function App() {
  const [view, setView] = useState('overview');
  const { loading, error, data } = useApi('/competitors');
  const items = (data && data.items) || [];

  if (loading) return <Card>Loading competitors…</Card>;
  if (error) return <Card title="Error">{error}</Card>;

  const totalFollowers = items.reduce((a, c) => a + (c.followers || 0), 0);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <nav style={{ display: 'flex', gap: 8 }}>
        {['overview', 'table'].map(v => (
          <button key={v} onClick={() => setView(v)}
            style={{ borderColor: view === v ? theme.accent : theme.border,
                     color: view === v ? theme.accent : theme.fg }}>{v}</button>
        ))}
      </nav>

      {view === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Card title="Competitors">
            <div style={{ fontSize: 28, fontWeight: 600 }}>{items.length}</div>
          </Card>
          <Card title="Total followers">
            <div style={{ fontSize: 28, fontWeight: 600 }}>
              {totalFollowers.toLocaleString()}
            </div>
          </Card>
        </div>
      )}

      {view === 'table' && (
        <Card title="All competitors">
          <table>
            <thead><tr><th>Handle</th><th>Followers</th><th>Avg likes</th></tr></thead>
            <tbody>
              {items.map(c => (
                <tr key={c.id}>
                  <td style={{ color: c.tint || theme.accent }}>{c.handle}</td>
                  <td>{(c.followers || 0).toLocaleString()}</td>
                  <td>{(c.avgLikes || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
render(<App />);
</ReactPreview>
```

## Pre-flight checklist

- [ ] No `import` / `export` / TypeScript annotations anywhere.
- [ ] `render(<App />)` called (or a top-level `App()` is defined).
- [ ] No shadcn/Tailwind/Radix/lucide references — inline styles only.
- [ ] Every `anubis.fetch` has loading + error + empty handling.
- [ ] Palette uses the inherited dark/gold theme, not a white AI-slop panel.
- [ ] Layout fits under ~720px or `maxHeight` is set deliberately.
- [ ] You actually need React — if one table/chart suffices, use the
      `mdx-response` component instead.
