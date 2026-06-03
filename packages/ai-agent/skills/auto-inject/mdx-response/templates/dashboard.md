# Dashboard config

Don't write a dashboard from scratch — write a JSON config and pipe it
through `scripts/render_dashboard.py`. The script emits a full
`<HtmlPreview>...</HtmlPreview>` (or `<ReactPreview>...</ReactPreview>`)
block; paste it into your reply unchanged.

## How to call

```bash
# from the folder containing this skill:
python scripts/render_dashboard.py --variant html --config /tmp/dash.json
# Windows alternative if `python` isn't on PATH:
py scripts/render_dashboard.py --variant html --config /tmp/dash.json

# stdin works too:
cat /tmp/dash.json | python scripts/render_dashboard.py --variant react
```

Flags:

- `--variant html|react` — `html` is smaller and renders faster; `react`
  is better when you'll want to extend the UI later with hooks/state.
  Default: `html`.
- `--config PATH` — JSON file. Omit to read from stdin.
- `--out PATH` — write the rendered block to a file instead of stdout.

## JSON schema

```jsonc
{
  // Header label, shown top-left.
  "title": "Competitor overview",

  // Optional. If false, the Refresh button is hidden. Default true.
  "refreshable": true,

  // Optional. If > 500, the dashboard auto-refreshes every N ms.
  "pollIntervalMs": null,

  // Optional. KPI tiles, rendered in a 1-4 column grid (capped at 4).
  // valuePath supports dotted paths and a `.length` suffix on arrays/strings.
  "kpis": [
    {
      "label": "Competitors",
      "route": "/competitors",
      "valuePath": "items.length",
      "format": "number"          // "number" | "date" | "handle" | "text"
      // "prefix": "$", "suffix": " posts"   // optional
    },
    {
      "label": "Posts captured",
      "route": "/posts?limit=20&orderBy=recent",
      "valuePath": "items.length",
      "format": "number"
    }
  ],

  // Optional. A single tabular panel.
  "table": {
    "title": "Top competitors",
    "route": "/competitors",
    "itemsPath": "items",         // default "items"
    "sortBy": "followers",        // optional dotted path
    "sortDir": "desc",            // "asc" | "desc" (default "desc")
    "limit": 6,                   // optional cap
    "columns": [
      { "label": "handle",     "field": "handle",         "format": "handle" },
      { "label": "followers",  "field": "followers",      "format": "number" },
      { "label": "posts",      "field": "capturedCount",  "format": "number" }
    ]
  },

  // Optional. A single sparkline panel.
  "chart": {
    "title": "Likes per recent post",
    "route": "/posts?limit=20&orderBy=recent",
    "itemsPath": "items",         // default "items"
    "yField": "likes"             // dotted path supported
  }
}
```

All keys except `nodes`-like requirements are optional — leave the dashboard
empty if you only want KPIs, or skip KPIs and only show a chart. The
renderer hides empty sections automatically.

## Format options

| `format` | Example input → output                              |
| ---      | ---                                                 |
| `number` | `412000` → `412.0k`, `42` → `42`                    |
| `date`   | `"2026-06-04T..."` → locale date string             |
| `handle` | `"nasa"` → `@nasa`                                  |
| `text`   | `"ready"` → `"ready"`                               |
| _omit_   | same as `text`                                      |

## Minimal example

```json
{
  "title": "Backend health",
  "kpis": [
    { "label": "Service", "route": "/health", "valuePath": "service" },
    { "label": "Status",  "route": "/health", "valuePath": "ok", "format": "text" }
  ]
}
```

Run: `python scripts/render_dashboard.py --config dash.json` → paste output
into your reply.

## Adapting

- Swap routes for whatever the user wants (`/competitors`, `/posts`,
  `/profiles`, `/conversations`, `/cron-jobs` — see the `anubis-core` skill
  for the full route catalogue).
- For Bahasa Indonesia, translate the `title` and `label` fields. The
  templates render values, not labels — they don't need translation.
- The iframe auto-sizes to its content. Pass `height={N}` on the resulting
  `<HtmlPreview>` only if you want a fixed height; otherwise leave it
  alone.
