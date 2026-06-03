#!/usr/bin/env python3
"""
Render an Anubis workflow / pipeline preview from a JSON config.

USAGE
    python render_workflow.py --variant html --config workflow.json
    cat workflow.json | python render_workflow.py --variant react

The output is a complete <HtmlPreview>...</HtmlPreview> or
<ReactPreview>...</ReactPreview> block, ready to paste into an assistant
reply. Config schema is documented in templates/workflow.md.

Auto-layout: nodes with no x/y are placed via Kahn's topological-sort
column packing (180px horizontal step, 100px vertical step). Nodes that
already carry x/y are left alone, so you can pin specific nodes and let
the rest auto-arrange.
"""
from __future__ import annotations
import argparse
import json
import pathlib
import sys


HERE = pathlib.Path(__file__).resolve().parent
VALID_STATUS = {'done', 'running', 'pending', 'failed'}


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding='utf-8')  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass

    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument(
        '--variant', choices=('html', 'react'), default='html',
        help='Which preview variant to emit. Default: html.',
    )
    ap.add_argument('--config', help='Path to a JSON config; otherwise stdin.')
    ap.add_argument('--out', help='Write to file instead of stdout.')
    args = ap.parse_args()

    try:
        config = load_config(args.config)
    except (OSError, json.JSONDecodeError) as e:
        print(f'render_workflow: failed to load config: {e}', file=sys.stderr)
        return 2

    try:
        validate(config)
        auto_layout(config)
    except ValueError as e:
        print(f'render_workflow: invalid config: {e}', file=sys.stderr)
        return 2

    tmpl_path = HERE / f'workflow.{args.variant}.tmpl'
    try:
        tmpl = tmpl_path.read_text(encoding='utf-8')
    except OSError as e:
        print(f'render_workflow: missing template {tmpl_path.name}: {e}', file=sys.stderr)
        return 2

    body = tmpl.replace('__CONFIG_JSON__', json.dumps(config))
    tag = 'ReactPreview' if args.variant == 'react' else 'HtmlPreview'
    output = f'<{tag}>\n{body.rstrip()}\n</{tag}>\n'

    if args.out:
        pathlib.Path(args.out).write_text(output, encoding='utf-8')
    else:
        sys.stdout.write(output)
    return 0


def load_config(path: str | None) -> dict:
    if path:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return json.load(sys.stdin)


def validate(c: dict) -> None:
    if not isinstance(c, dict):
        raise ValueError('config must be a JSON object')
    nodes = c.get('nodes')
    if not isinstance(nodes, list) or not nodes:
        raise ValueError('nodes must be a non-empty list')
    ids: set[str] = set()
    for i, n in enumerate(nodes):
        if not isinstance(n, dict):
            raise ValueError(f'nodes[{i}] must be an object')
        for f in ('id', 'label', 'status'):
            if f not in n:
                raise ValueError(f'nodes[{i}].{f} is required')
        if n['status'] not in VALID_STATUS:
            raise ValueError(
                f'nodes[{i}].status must be one of {sorted(VALID_STATUS)}'
            )
        if n['id'] in ids:
            raise ValueError(f'duplicate node id "{n["id"]}"')
        ids.add(n['id'])
    edges = c.get('edges') or []
    if not isinstance(edges, list):
        raise ValueError('edges must be a list')
    for i, e in enumerate(edges):
        if not isinstance(e, dict) or 'from' not in e or 'to' not in e:
            raise ValueError(f'edges[{i}] must have "from" and "to"')
        if e['from'] not in ids:
            raise ValueError(
                f'edges[{i}].from "{e["from"]}" is not a known node id'
            )
        if e['to'] not in ids:
            raise ValueError(f'edges[{i}].to "{e["to"]}" is not a known node id')


def auto_layout(c: dict) -> None:
    """Fill missing x/y on every node via topological column packing."""
    nodes = {n['id']: n for n in c['nodes']}
    edges = c.get('edges') or []
    if all('x' in n and 'y' in n for n in nodes.values()):
        return

    incoming = {nid: 0 for nid in nodes}
    successors: dict[str, list[str]] = {nid: [] for nid in nodes}
    for e in edges:
        incoming[e['to']] += 1
        successors[e['from']].append(e['to'])

    depth = {nid: 0 for nid in nodes}
    frontier = [nid for nid, n in incoming.items() if n == 0]
    seen: set[str] = set()
    while frontier:
        nxt: list[str] = []
        for nid in frontier:
            if nid in seen:
                continue
            seen.add(nid)
            for s in successors[nid]:
                depth[s] = max(depth[s], depth[nid] + 1)
                nxt.append(s)
        frontier = nxt

    columns: dict[int, list[str]] = {}
    for nid, d in depth.items():
        columns.setdefault(d, []).append(nid)

    DX, DY = 180, 100
    PAD_X, PAD_Y = 30, 30
    for col, ids_in_col in columns.items():
        for row, nid in enumerate(ids_in_col):
            node = nodes[nid]
            if 'x' not in node:
                node['x'] = PAD_X + col * DX
            if 'y' not in node:
                node['y'] = PAD_Y + row * DY


if __name__ == '__main__':
    sys.exit(main())
