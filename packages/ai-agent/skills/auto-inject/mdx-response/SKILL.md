---
name: mdx-response
description: Format assistant responses as MDX using the whitelisted components the Anubis frontend renders (Buttons, Button, DataTable, KeyValueList, LineChart, HtmlPreview, ReactPreview). Plain markdown still works; reach for components when they communicate better than text. Use HtmlPreview / ReactPreview to ship interactive dashboards, charts, and workflow visualisations live inside the chat.
when_to_use: Always - this is the default response format for the Anubis desktop UI. Any reply the user sees is rendered by the MDX pipeline. Prefer a component over a markdown table/list whenever the data fits one of the supported shapes. Use HtmlPreview / ReactPreview when the user asks for a dashboard, real-time view, visual workflow, or any UI more elaborate than a single table or chart.
---

# MDX Response

Every reply renders through MDX. Plain markdown works. Only the 7 tags below are real components — every other `<Tag>` renders as text.

## Rules

- Don't invent components. Unknown tags → grey fallback box.
- Props: `name="string"` or `name={JSON}`. Single quotes / unquoted values / JS expressions = rejected.
- JSON in `{ ... }` is `JSON.parse`d. Double-quoted keys, no trailing commas, no comments.
- Self-closing (`<DataTable ... />`) or paired (`<Buttons>...</Buttons>`).
- Mix freely with markdown.
- Lead with one sentence of prose, then the component. Don't wrap the whole reply in one component.
- No markdown inside props. Props are JSON / strings only.
- `<HtmlPreview>` / `<ReactPreview>` children captured raw — no markdown inside.
- Empty components (`rows: []`, `items: {}`, `data: []`) render to nothing. Skip them.

## Whitelist

### `<Button>` / `<Buttons>`

1–4 click-to-send actions. Child text = label. `send` = message posted on click. `style`: `primary` (default) | `secondary` | `danger`.

```mdx
<Buttons>
  <Button send="Yes, capture @nasa now" style="primary">Capture @nasa</Button>
  <Button send="Cancel" style="danger">Cancel</Button>
</Buttons>
```

Single action → emit `<Button />` inline, skip `<Buttons>`.

### `<DataTable columns={[...]} rows={[[...]]} />`

3+ rows of homogeneous data. Cells: string | number | boolean | null (`—`).

```mdx
<DataTable
  columns={["handle", "followers", "avg_likes"]}
  rows={[["@nasa", 98200000, 412000], ["@spacex", 39100000, 287500]]}
/>
```

### `<KeyValueList items={{ ... }} />`

≤ ~8 named fields. Label left, value right.

```mdx
<KeyValueList items={{ "handle": "@nasa", "followers": 98200000, "status": "ready" }} />
```

### `<LineChart data={[...]} xKey="..." yKey="..." title="..." />`

Single series, static data already in hand. For live data use `<ReactPreview>`.

```mdx
<LineChart title="Likes" xKey="date" yKey="likes"
  data={[{"date":"05-25","likes":312000},{"date":"05-27","likes":405000}]} />
```

### `<HtmlPreview>...</HtmlPreview>`

Sandboxed iframe. Raw HTML/CSS/JS. Auto-resizes; fallback `maxHeight` 720px scrollable.

Props: `height={400}` (fixed) | `maxHeight={900}`.

```mdx
<HtmlPreview>
<div id="out">loading…</div>
<script>
  anubis.fetch('/health').then(r => r.json()).then(j => {
    document.getElementById('out').textContent = JSON.stringify(j, null, 2);
  });
</script>
</HtmlPreview>
```

### `<ReactPreview>...</ReactPreview>`

Sandboxed iframe. React 18 + ReactDOM + Babel-standalone auto-loaded. Same auto-resize.

```mdx
<ReactPreview>
function App() {
  const [n, setN] = useState(0);
  return <button onClick={() => setN(n + 1)}>Count: {n}</button>;
}
render(<App />);
</ReactPreview>
```

Available inside:
- `React`, `ReactDOM` globals
- Hooks: `useState`, `useEffect`, `useMemo`, `useRef`, `useCallback`, `useReducer`
- `render(<X />)` mounts to `#root`. Skip it if you define a top-level `App()` — auto-mounts.
- `anubis.fetch(path, init)` — CORS-safe backend call. Returns Response-shaped `{ ok, status, headers, json(), text() }`.
- `anubis.setHeight(px)` — explicit height override (rarely needed).

**Plain JSX only.** No TypeScript (no `interface`, `as const`, generics, annotations). No `import`/`export`. No npm. No Tailwind. Style with `style={{...}}`.

For anything bigger than one component (multi-tab dashboards, reusable primitives, live data) → read `web-artifacts-builder` skill.

## Picker

| Situation | Use |
| --- | --- |
| 1–4 actions to click | `<Button>` / `<Buttons>` |
| 3+ rows tabular | `<DataTable />` |
| ≤ ~8 named fields | `<KeyValueList />` |
| Static metric over axis | `<LineChart />` |
| Dashboard, KPIs + chart + table | `<HtmlPreview />` (see `templates/dashboard.md`) |
| Workflow / pipeline / DAG | `<HtmlPreview />` (see `templates/workflow.md`) |
| Interactive React, hooks, state | `<ReactPreview />` |
| Multi-component React, tabs, live fetch | `<ReactPreview />` → `web-artifacts-builder` skill |
| Needs CDN lib (Chart.js/D3) or Tailwind | `<HtmlPreview />` → `web-artifacts-builder` skill |
| Prose, explanations, code | plain markdown |

## anubis.fetch

The iframe origin is `null` so direct `fetch()` would CORS-fail. `anubis.fetch(path, init)` proxies through the parent.

- `path` relative (`/posts?limit=10`) resolves to the running backend, or absolute URL.
- `init` plain `RequestInit`. Body must be a serialisable string.
- Returned: `{ ok, status, headers.get('content-type'), .json(), .text() }`.

Routes documented in `anubis-core/*.md`.

## Templates — run the script, don't copy

For dashboards / workflows. Write JSON, run script, paste output.

### Dashboard

```bash
cat > /tmp/dash.json <<'EOF'
{
  "title": "Competitor overview",
  "kpis": [
    { "label": "Competitors",    "route": "/competitors",                   "valuePath": "items.length", "format": "number" },
    { "label": "Posts captured", "route": "/posts?limit=20&orderBy=recent", "valuePath": "items.length", "format": "number" }
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
python scripts/render_dashboard.py --variant react --config /tmp/dash.json
# Windows: py scripts/render_dashboard.py ...
```

Stdout is a complete `<ReactPreview>...</ReactPreview>` block. Paste verbatim. Schema: `templates/dashboard.md`.

### Workflow

```bash
cat > /tmp/wf.json <<'EOF'
{
  "title": "Capture pipeline",
  "nodes": [
    { "id": "discover", "label": "Discover", "status": "done" },
    { "id": "capture",  "label": "Capture",  "status": "running" },
    { "id": "persist",  "label": "Persist",  "status": "pending" }
  ],
  "edges": [
    { "from": "discover", "to": "capture" },
    { "from": "capture",  "to": "persist" }
  ]
}
EOF
python scripts/render_workflow.py --variant html --config /tmp/wf.json
```

`x`/`y` optional — auto-layout by topological depth. Schema: `templates/workflow.md`.

### About the scripts

Live at `scripts/`. Read JSON from `--config FILE` or stdin. Bail with clear message + exit 2 on bad input. Print complete `<HtmlPreview>` / `<ReactPreview>` block to stdout (or `--out FILE`). Don't read `.tmpl` files yourself.

## Cron + i18n

- `[CRON_*]` protocol blocks (see `cron-helper` skill) are stripped before MDX parsing.
- Bahasa Indonesia in markdown + string props renders fine — unicode-clean.
