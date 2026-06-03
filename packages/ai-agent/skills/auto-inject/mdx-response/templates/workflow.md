# Workflow / pipeline config

Don't write a workflow viz from scratch — write a JSON config and pipe it
through `scripts/render_workflow.py`. The script emits a full
`<HtmlPreview>...</HtmlPreview>` (or `<ReactPreview>...</ReactPreview>`)
block; paste it into your reply unchanged.

## How to call

```bash
python scripts/render_workflow.py --variant html --config /tmp/wf.json
# Windows: py scripts/render_workflow.py --variant html --config /tmp/wf.json
cat /tmp/wf.json | python scripts/render_workflow.py --variant react
```

Flags:

- `--variant html|react` — `html` is smaller; `react` is better when the
  workflow is live and updates while the user watches. Default: `html`.
- `--config PATH` — JSON file. Omit to read from stdin.
- `--out PATH` — write the rendered block to a file instead of stdout.

## JSON schema

```jsonc
{
  // Optional. Header label.
  "title": "Capture pipeline",

  // Required. Pipeline nodes.
  // x/y are optional — if absent, auto-layout places them by topological
  // depth (180px columns, 100px rows). Mix-and-match is fine: pin the
  // ones that matter, let the script place the rest.
  "nodes": [
    { "id": "discover", "label": "Discover", "status": "done",    "info": "discoverCompetitors(...)",  "ms": 1200 },
    { "id": "capture",  "label": "Capture",  "status": "done",    "info": "POST /captures/:id",         "ms": 8400 },
    { "id": "parse",    "label": "Parse",    "status": "running", "info": "parsePosts(); avgLikes()" },
    { "id": "enrich",   "label": "Enrich",   "status": "pending", "info": "OCR captions + classify"   },
    { "id": "persist",  "label": "Persist",  "status": "pending", "info": "sqlite write batch"        }
  ],

  // Required (may be empty). Edges between node ids.
  "edges": [
    { "from": "discover", "to": "capture" },
    { "from": "capture",  "to": "parse"   },
    { "from": "parse",    "to": "enrich"  },
    { "from": "enrich",   "to": "persist" }
  ],

  // Optional. If set, the diagram polls this route every pollIntervalMs
  // and updates nodes/edges in-place. Route should respond with:
  //   { workflow: { nodes: [...], edges: [...] } }
  // or directly { nodes: [...], edges: [...] }.
  "pollRoute": null,
  "pollIntervalMs": 2000
}
```

## Status values

| `status`  | Visual                                       |
| ---       | ---                                          |
| `done`    | green text label                             |
| `running` | gold text + animated dashed incoming edge    |
| `pending` | grey                                         |
| `failed`  | red                                          |

Anything else fails validation.

## Minimal example

```json
{
  "title": "Simple pipeline",
  "nodes": [
    { "id": "in",  "label": "Ingest",  "status": "done"    },
    { "id": "mid", "label": "Process", "status": "running" },
    { "id": "out", "label": "Persist", "status": "pending" }
  ],
  "edges": [
    { "from": "in",  "to": "mid" },
    { "from": "mid", "to": "out" }
  ]
}
```

Run: `python scripts/render_workflow.py --config wf.json` → paste output
into your reply.

## Adapting

- For wide pipelines (>6 nodes), set explicit `x` on key nodes to break
  them into multiple rows; auto-layout will respect your pins and pack
  the rest around them.
- For Bahasa Indonesia, translate the `title`, `label`, and `info` fields.
  Status strings stay English (they're enum keys).
- The iframe auto-sizes to the diagram. Pass `maxHeight={N}` on the
  resulting `<HtmlPreview>` only if you want to cap a very tall workflow
  below the default 720px.
