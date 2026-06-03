import { useEffect, useMemo, useRef, useState } from 'react'
import { getApiBaseUrl } from '@/api'
import { cn } from '@/lib/utils'

export interface SandboxedFrameProps {
  /** Full HTML document to load via srcdoc. Recomputed only when this string changes. */
  srcdoc: string
  /** Fixed pixel height. If set, the auto-resize protocol is ignored. */
  height?: number
  /** Cap for auto-resize. Default 720. */
  maxHeight?: number
  /** Starting height before the iframe reports back. Default 240. */
  initialHeight?: number
  className?: string
  label?: string
}

/**
 * Sandboxed iframe shell shared by <HtmlPreview /> and <ReactPreview />.
 *
 *  - srcdoc + sandbox="allow-scripts" (no allow-same-origin → origin is "null")
 *  - the iframe auto-reports its scrollHeight via postMessage; we resize
 *    the frame to match, up to `maxHeight`
 *  - cross-origin fetch is proxied through the parent so the backend's
 *    localhost-only CORS policy doesn't reject the iframe (whose origin
 *    would otherwise be "null")
 */
export function SandboxedFrame({
  srcdoc,
  height,
  maxHeight = 720,
  initialHeight = 240,
  className,
  label = 'Anubis preview',
}: SandboxedFrameProps) {
  const ref = useRef<HTMLIFrameElement | null>(null)
  const [autoHeight, setAutoHeight] = useState<number | null>(null)
  const [capped, setCapped] = useState(false)

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!ref.current || e.source !== ref.current.contentWindow) return
      const data = e.data as Record<string, unknown> | null
      if (!data || data.__anubis === undefined) return

      if (data.__anubis === 'height') {
        if (height !== undefined) return
        const h = Math.ceil(Number(data.height) || 0)
        if (!Number.isFinite(h) || h <= 0) return
        if (h > maxHeight) {
          setAutoHeight(maxHeight)
          setCapped(true)
        } else {
          setAutoHeight(Math.max(60, h))
          setCapped(false)
        }
      } else if (data.__anubis === 'fetch') {
        void proxyFetch(ref.current.contentWindow, data)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [height, maxHeight])

  // Reset auto-height when srcdoc changes (new iframe content)
  useEffect(() => {
    setAutoHeight(null)
    setCapped(false)
  }, [srcdoc])

  const resolvedHeight = height ?? autoHeight ?? initialHeight

  return (
    <div
      className={cn(
        'my-3 overflow-hidden rounded-md border border-border bg-card',
        className,
      )}
    >
      <iframe
        ref={ref}
        srcDoc={srcdoc}
        sandbox='allow-scripts'
        referrerPolicy='no-referrer'
        className='block w-full border-0 bg-transparent'
        style={{ height: resolvedHeight + 'px' }}
        title={label}
      />
      {capped && (
        <div className='border-t border-border bg-muted/40 px-3 py-1.5 font-mono text-[11px] text-muted-foreground'>
          Content exceeds {maxHeight}px — preview scrolls inside the frame.
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------
   Fetch proxy
   ------------------------------------------------------------ */

async function proxyFetch(
  target: Window | null,
  data: Record<string, unknown>,
): Promise<void> {
  if (!target) return
  const id = data.id
  try {
    const base = await getApiBaseUrl()
    const rawPath = String(data.path ?? '')
    const url = /^https?:\/\//i.test(rawPath)
      ? rawPath
      : `${base.replace(/\/$/, '')}${rawPath.startsWith('/') ? '' : '/'}${rawPath}`
    const init = (data.init ?? {}) as RequestInit
    const r = await fetch(url, init)
    const ct = r.headers.get('content-type') ?? ''
    const isJson = ct.includes('application/json')
    const body = isJson ? await r.json() : await r.text()
    target.postMessage(
      {
        __anubis: 'fetch-result',
        id,
        ok: r.ok,
        status: r.status,
        contentType: ct,
        body,
      },
      '*',
    )
  } catch (err) {
    target.postMessage(
      {
        __anubis: 'fetch-result',
        id,
        error: err instanceof Error ? err.message : String(err),
      },
      '*',
    )
  }
}

/* ------------------------------------------------------------
   Runtime shim injected into every preview iframe
   ------------------------------------------------------------ */

/**
 * The runtime script that runs inside the iframe. Exposes:
 *
 *   window.anubis.fetch(path, init)  → proxied through parent
 *   window.anubis.setHeight(px)      → explicit height override
 *
 * Also installs a ResizeObserver + MutationObserver that reports body
 * scrollHeight to the parent automatically.
 */
export const PREVIEW_RUNTIME_SCRIPT = `
(function () {
  var pending = Object.create(null);
  function rid() {
    return 'a' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.__anubis !== 'fetch-result') return;
    var cb = pending[d.id];
    if (!cb) return;
    delete pending[d.id];
    if (d.error) {
      cb.reject(new Error(d.error));
      return;
    }
    var bodyVal = d.body;
    cb.resolve({
      ok: d.ok,
      status: d.status,
      headers: { get: function (k) { return k.toLowerCase() === 'content-type' ? d.contentType : null; } },
      json: function () { return Promise.resolve(typeof bodyVal === 'string' ? JSON.parse(bodyVal) : bodyVal); },
      text: function () { return Promise.resolve(typeof bodyVal === 'string' ? bodyVal : JSON.stringify(bodyVal)); },
    });
  });
  var anubis = {
    fetch: function (path, init) {
      return new Promise(function (resolve, reject) {
        var id = rid();
        pending[id] = { resolve: resolve, reject: reject };
        window.parent.postMessage({ __anubis: 'fetch', id: id, path: path, init: init || {} }, '*');
      });
    },
    setHeight: function (px) {
      window.parent.postMessage({ __anubis: 'height', height: Math.ceil(Number(px) || 0) }, '*');
    },
  };
  window.anubis = anubis;

  function reportHeight() {
    var h = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    );
    window.parent.postMessage({ __anubis: 'height', height: h }, '*');
  }
  function start() {
    if (!document.body) return;
    if (window.ResizeObserver) {
      new ResizeObserver(reportHeight).observe(document.body);
    }
    new MutationObserver(reportHeight).observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener('load', reportHeight);
    requestAnimationFrame(reportHeight);
    setTimeout(reportHeight, 200);
    setTimeout(reportHeight, 600);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
`

/* ------------------------------------------------------------
   Base styles applied inside every preview iframe
   ------------------------------------------------------------ */

export const PREVIEW_BASE_CSS = `
:root {
  color-scheme: dark light;
  --fg: #e6e7ea;
  --muted: #9a9ba1;
  --border: rgba(255,255,255,0.10);
  --card: rgba(255,255,255,0.04);
  --accent: #d4a85c;
}
html, body {
  margin: 0;
  padding: 0;
  background: transparent;
  color: var(--fg);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.55;
}
body { padding: 12px; }
* { box-sizing: border-box; }
a { color: var(--accent); }
button {
  font: inherit;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--fg);
  padding: 6px 10px;
  border-radius: 6px;
}
button:hover { background: rgba(255,255,255,0.08); }
table { border-collapse: collapse; width: 100%; }
th, td { padding: 6px 10px; border-bottom: 1px solid var(--border); text-align: left; }
th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 500; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
`

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */

export function useMemoizedSrcdoc(build: () => string, deps: unknown[]): string {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(build, deps)
}
