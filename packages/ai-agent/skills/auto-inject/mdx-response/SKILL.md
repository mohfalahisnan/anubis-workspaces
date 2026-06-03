---
name: mdx-response
description: Format assistant responses as MDX using the whitelisted components the Anubis frontend renders (Buttons, Button, DataTable, KeyValueList, LineChart, HtmlPreview, ReactPreview). Plain markdown still works; reach for components when they communicate better than text. Use HtmlPreview / ReactPreview to ship interactive dashboards, charts, and workflow visualisations live inside the chat.
when_to_use: Always - this is the default response format for the Anubis desktop UI. Any reply the user sees is rendered by the MDX pipeline. Prefer a component over a markdown table/list whenever the data fits one of the supported shapes. Use HtmlPreview / ReactPreview when the user asks for a dashboard, real-time view, visual workflow, or any UI more elaborate than a single table or chart.
---

# MDX Response Format

Every assistant message in this app passes through the MDX renderer at
`packages/frontend/src/components/mdx`. Plain GitHub-flavoured markdown is
rendered by Streamdown. **Only the seven tags in the whitelist below are
parsed as components** — every other `<Tag>` flows through unchanged as
text. Anything outside the whitelist is wasted typing.

## Output rules

- Write a normal markdown reply. Drop a component in where it carries the
  message better than prose (a table of metrics, a yes/no confirmation, a
  trend over time, a live dashboard).
- Do **not** invent components. The renderer hard-fails to a grey fallback
  box for unknown tags.
- Props are quoted strings (`name="value"`) or JSON in braces
  (`name={[1,2,3]}`). Single quotes, unquoted values, and JS expressions are
  rejected.
- JSON inside `{ ... }` is parsed by `JSON.parse`. Keys and strings must be
  double-quoted. No trailing commas, no comments.
- Components can be self-closing (`<DataTable ... />`) or paired
  (`<Buttons>...</Buttons>`).
- Mix freely with markdown: paragraphs, headings, fences, lists, and tables
  outside the whitelist behave exactly like normal markdown.

## Whitelist

### `<Buttons>` + `<Button send="..." style="primary|secondary|danger">`

Use when the next step is a small set of discrete actions the user should
trigger by clicking. The button label is the child text; `send` is the
literal message that gets posted back into the conversation when clicked.

```mdx
<Buttons>
  <Button send="Yes, capture @nasa now" style="primary">Capture @nasa</Button>
  <Button send="Show me the captured profile first" style="secondary">Preview first</Button>
  <Button send="Cancel" style="danger">Cancel</Button>
</Buttons>
```

Default `style` is `primary`. Skip `<Buttons>` and emit a single `<Button />`
inline if there's only one action.

### `<DataTable columns={[...]} rows={[[...], ...]} />`

Tabular data with a fixed column order. Cells may be string, number, boolean,
or `null` (renders as `—`). Prefer this over a markdown table when the values
are numeric or when there are more than ~3 columns.

```mdx
<DataTable
  columns={["handle", "followers", "avg_likes"]}
  rows={[
    ["@nasa", 98200000, 412000],
    ["@spacex", 39100000, 287500],
    ["@esa", 4800000, 41200]
  ]}
/>
```

### `<KeyValueList items={{ ... }} />`

A two-column metadata block: label on the left, value on the right. Use for
a small set of named fields (a captured profile summary, a job's
parameters, a health response).

```mdx
<KeyValueList items={{
  "handle": "@nasa",
  "followers": 98200000,
  "posts_captured": 36,
  "last_capture": "2026-06-04T09:14:00Z",
  "status": "ready"
}} />
```

### `<LineChart data={[...]} xKey="..." yKey="..." title="..." />`

Single-series line chart for a static set of points already in hand. For a
live chart that fetches its own data, use `<ReactPreview />` instead.

```mdx
<LineChart
  title="Likes per post (last 5)"
  xKey="date"
  yKey="likes"
  data={[
    {"date": "05-25", "likes": 312000},
    {"date": "05-27", "likes": 405000},
    {"date": "05-29", "likes": 289000},
    {"date": "06-01", "likes": 511000},
    {"date": "06-03", "likes": 478000}
  ]}
/>
```

### `<HtmlPreview>...</HtmlPreview>`

Render raw HTML/CSS/JS inside a sandboxed iframe. Use for dashboards,
custom charts, interactive widgets, or any view richer than a single table.
The iframe **auto-resizes** to its content and falls back to `maxHeight`
(default 720px, scrollable) if the content is taller.

```mdx
<HtmlPreview>
<div class="card">
  <h3 style="margin:0 0 8px;">Backend health</h3>
  <div id="out">loading…</div>
</div>
<script>
  anubis.fetch('/health').then(r => r.json()).then(j => {
    document.getElementById('out').textContent = JSON.stringify(j, null, 2);
  });
</script>
</HtmlPreview>
```

Optional props: `height={400}` (fixed), `maxHeight={900}` (override the
720px cap).

### `<ReactPreview>...</ReactPreview>`

Render a React component inside a sandboxed iframe. React 18, ReactDOM, and
Babel-standalone are auto-loaded; write JSX directly. The same auto-resize
+ `maxHeight` behaviour applies.

```mdx
<ReactPreview>
function App() {
  const [n, setN] = useState(0);
  return (
    <div className="card">
      <h3 style={{ margin: 0 }}>Counter: {n}</h3>
      <button onClick={() => setN(n + 1)}>+1</button>
    </div>
  );
}
render(<App />);
</ReactPreview>
```

Inside the preview you get:

- `React`, `ReactDOM` as globals
- Hook aliases: `useState`, `useEffect`, `useMemo`, `useRef`, `useCallback`, `useReducer`
- `render(<X />)` mounts X into `#root`. If you skip it but define a
  top-level `App()` component, it auto-mounts.
- `anubis.fetch(path, init)` — CORS-safe Anubis backend call (proxied
  through the parent). Returns a Response-shaped object with `.json()`
  and `.text()`.
- `anubis.setHeight(px)` — explicit height override (auto-resize is on by
  default; you rarely need this).

## How `anubis.fetch` works

Both previews can hit the Anubis backend. Because the iframe is sandboxed
without `allow-same-origin`, its origin is `null` — direct `fetch()` to
the backend would fail CORS. `anubis.fetch(path, init)` posts the request
to the parent window, which performs the real `fetch()` and posts the
result back.

- `path` may be relative (`/posts?limit=10`) or absolute (`http://...`).
  Relative paths resolve against the running Anubis backend.
- `init` is a plain `RequestInit` (method, headers, body — body should be
  a string for JSON, since structured clone needs serialisable values).
- Returned object exposes `ok`, `status`, `headers.get('content-type')`,
  `.json()`, `.text()`.

Routes are documented in the `anubis-core` skill folder
(`anubis-core/competitors.md`, `crawler.md`, `conversations.md`, `admin.md`).

## When to pick which

| Situation | Use |
| --- | --- |
| 1–4 next-step actions the user should click | `<Button>` / `<Buttons>` |
| 3+ rows of homogeneous tabular data | `<DataTable />` |
| A single object's named fields (≤ ~8 entries) | `<KeyValueList />` |
| A metric over an ordered axis, data already known | `<LineChart />` |
| Multi-panel dashboard, KPIs + chart + table | `<HtmlPreview />` (see `templates/dashboard.md`) |
| Workflow / pipeline / DAG diagram, possibly live | `<HtmlPreview />` (see `templates/workflow.md`) |
| Interactive React component, hooks, state | `<ReactPreview />` |
| Free-form explanation, prose, code | plain markdown |

## Templates — call the script, don't copy

For dashboards and workflow visualisations there is a generator script.
Write a small JSON config, run it, paste the output. **Do not copy template
content into your reply** — the script is deterministic and the templates
will drift if hand-edited.

### Dashboard

```bash
# Write the config to a temp file
cat > /tmp/dash.json <<'EOF'
{
  "title": "Competitor overview",
  "kpis": [
    { "label": "Competitors",    "route": "/competitors",                       "valuePath": "items.length", "format": "number" },
    { "label": "Posts captured", "route": "/posts?limit=20&orderBy=recent",     "valuePath": "items.length", "format": "number" }
  ],
  "table": {
    "title": "Top competitors", "route": "/competitors", "sortBy": "followers", "limit": 6,
    "columns": [
      { "label": "handle",    "field": "handle",        "format": "handle" },
      { "label": "followers", "field": "followers",     "format": "number" },
      { "label": "posts",     "field": "capturedCount", "format": "number" }
    ]
  }
}
EOF

# Render (defaults to --variant html)
python scripts/render_dashboard.py --variant react --config /tmp/dash.json
# Windows where python isn't on PATH:
py scripts/render_dashboard.py --variant react --config /tmp/dash.json
```

The script's stdout is a complete `<ReactPreview>...</ReactPreview>`
block. Paste it into your reply verbatim. Full schema reference:
`skills/mdx-response/templates/dashboard.md`.

### Workflow / pipeline

```bash
cat > /tmp/wf.json <<'EOF'
{
  "title": "Capture pipeline",
  "nodes": [
    { "id": "discover", "label": "Discover", "status": "done" },
    { "id": "capture",  "label": "Capture",  "status": "done" },
    { "id": "parse",    "label": "Parse",    "status": "running" },
    { "id": "persist",  "label": "Persist",  "status": "pending" }
  ],
  "edges": [
    { "from": "discover", "to": "capture" },
    { "from": "capture",  "to": "parse"   },
    { "from": "parse",    "to": "persist" }
  ]
}
EOF

python scripts/render_workflow.py --variant html --config /tmp/wf.json
```

`x`/`y` are optional — auto-layout places nodes by topological depth.
Full schema reference: `skills/mdx-response/templates/workflow.md`.

### Both scripts

Live under `skills/mdx-response/scripts/`. They:

- Read JSON from `--config FILE` or stdin
- Validate the shape; bail with a clear message and exit code 2 on bad input
- Substitute `__CONFIG_JSON__` into the matching `.tmpl` file
- Print a complete `<HtmlPreview>` / `<ReactPreview>` block to stdout
  (or `--out FILE`)

You never need to read the `.tmpl` files yourself — the script handles
them. If the script reports a validation error, read the schema doc
(`templates/dashboard.md` / `templates/workflow.md`) and fix the config.

## Quick rules of thumb

- Lead with a sentence of prose, then the component, then optional
  follow-up text. Don't wrap the whole reply in a single component.
- Don't emit empty components — `rows: []`, `items: {}`, `data: []`,
  empty `<HtmlPreview>` all render to nothing.
- Don't put markdown inside a component's props. Props are JSON / strings.
- For `<HtmlPreview>` and `<ReactPreview>`, the **children are captured
  raw** — no markdown processing inside. Whatever you write between the
  tags goes into the iframe verbatim.
- Don't include `</HtmlPreview>` or `</ReactPreview>` literally inside the
  content (they end the block early). This is essentially never a real
  problem.
- The `[CRON_*]` protocol blocks (see the `cron-helper` skill) are stripped
  before MDX parsing.
- For Indonesian replies, Bahasa Indonesia inside markdown and string props
  renders fine — the renderer is unicode-clean.
