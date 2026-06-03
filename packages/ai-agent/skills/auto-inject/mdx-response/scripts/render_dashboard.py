#!/usr/bin/env python3
"""
Render an Anubis dashboard preview from a JSON config.

USAGE
    python render_dashboard.py --variant html [--config dashboard.json]
    python render_dashboard.py --variant react --config dashboard.json
    cat dashboard.json | python render_dashboard.py --variant react

The output is a complete <HtmlPreview>...</HtmlPreview> or
<ReactPreview>...</ReactPreview> block, ready to paste into an assistant
reply. Config schema is documented in templates/dashboard.md.

The script is deterministic — given the same config it always emits the
same block. Loading the .tmpl files is cheap; do not inline them into
your reply.
"""
from __future__ import annotations
import argparse
import json
import pathlib
import sys


HERE = pathlib.Path(__file__).resolve().parent


def main() -> int:
    # Force UTF-8 stdout so em-dashes etc. survive Windows consoles.
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
    ap.add_argument(
        '--config',
        help='Path to a JSON config file. If omitted, reads from stdin.',
    )
    ap.add_argument(
        '--out',
        help='Write the rendered block to this file instead of stdout.',
    )
    args = ap.parse_args()

    try:
        config = load_config(args.config)
    except (OSError, json.JSONDecodeError) as e:
        print(f'render_dashboard: failed to load config: {e}', file=sys.stderr)
        return 2

    try:
        validate(config)
    except ValueError as e:
        print(f'render_dashboard: invalid config: {e}', file=sys.stderr)
        return 2

    tmpl_path = HERE / f'dashboard.{args.variant}.tmpl'
    try:
        tmpl = tmpl_path.read_text(encoding='utf-8')
    except OSError as e:
        print(f'render_dashboard: missing template {tmpl_path.name}: {e}', file=sys.stderr)
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
    if 'title' in c and not isinstance(c['title'], str):
        raise ValueError('title must be a string')
    for i, k in enumerate(c.get('kpis') or []):
        if not isinstance(k, dict):
            raise ValueError(f'kpis[{i}] must be an object')
        for f in ('label', 'route', 'valuePath'):
            if f not in k:
                raise ValueError(f'kpis[{i}].{f} is required')
    t = c.get('table')
    if t is not None:
        if not isinstance(t, dict):
            raise ValueError('table must be an object')
        if 'route' not in t:
            raise ValueError('table.route is required')
        cols = t.get('columns')
        if not isinstance(cols, list) or not cols:
            raise ValueError('table.columns must be a non-empty list')
        for i, col in enumerate(cols):
            if not isinstance(col, dict) or 'label' not in col or 'field' not in col:
                raise ValueError(
                    f'table.columns[{i}] must be an object with "label" and "field"'
                )
    ch = c.get('chart')
    if ch is not None:
        if not isinstance(ch, dict):
            raise ValueError('chart must be an object')
        if 'route' not in ch or 'yField' not in ch:
            raise ValueError('chart.route and chart.yField are required')


if __name__ == '__main__':
    sys.exit(main())
