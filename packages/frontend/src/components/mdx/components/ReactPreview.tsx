import {
  PREVIEW_BASE_CSS,
  PREVIEW_RUNTIME_SCRIPT,
  SandboxedFrame,
  useMemoizedSrcdoc,
} from './sandboxed-frame'

export interface ReactPreviewProps {
  code: string
  height?: number
  maxHeight?: number
}

const REACT_CDN = 'https://unpkg.com/react@18.3.1/umd/react.production.min.js'
const REACT_DOM_CDN = 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js'
const BABEL_CDN = 'https://unpkg.com/@babel/standalone@7.24.7/babel.min.js'

/**
 * Render a React component inside a sandboxed iframe. The model writes
 * JSX as the children of <ReactPreview>; we load React + ReactDOM + Babel
 * from a CDN inside the frame and execute the JSX with
 * `Babel.transform(..., { presets: ['react','env'] })`.
 *
 * Inside the user code:
 *   - React and ReactDOM are globals
 *   - `render(<X />)` mounts X into #root
 *   - `anubis.fetch(path, init)` proxies through the parent (CORS-safe)
 *   - useState / useEffect / useMemo / useRef are aliased on `window`
 */
export function ReactPreview({ code, height, maxHeight }: ReactPreviewProps) {
  const srcdoc = useMemoizedSrcdoc(() => buildReactDoc(code), [code])
  return (
    <SandboxedFrame
      srcdoc={srcdoc}
      height={height}
      maxHeight={maxHeight}
      label='React preview'
    />
  )
}

function buildReactDoc(userCode: string): string {
  const trimmed = userCode.trim()
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>${PREVIEW_BASE_CSS}</style>
<script>${PREVIEW_RUNTIME_SCRIPT}</script>
<script src="${REACT_CDN}" crossorigin></script>
<script src="${REACT_DOM_CDN}" crossorigin></script>
<script src="${BABEL_CDN}" crossorigin></script>
</head>
<body>
<div id="root"></div>
<script>
(function () {
  function showError(msg) {
    var el = document.getElementById('root');
    el.innerHTML = '<pre style="color:#ff8a8a;background:rgba(255,80,80,0.08);border:1px solid rgba(255,80,80,0.25);padding:10px;border-radius:6px;white-space:pre-wrap;font-size:12px;">' +
      String(msg).replace(/</g, '&lt;') + '</pre>';
  }
  window.addEventListener('error', function (e) { showError(e.message || e.error || 'Unknown error'); });
  window.addEventListener('unhandledrejection', function (e) { showError((e.reason && e.reason.message) || e.reason || 'Unhandled promise rejection'); });

  function boot() {
    if (typeof React === 'undefined' || typeof ReactDOM === 'undefined' || typeof Babel === 'undefined') {
      return setTimeout(boot, 30);
    }
    window.useState = React.useState;
    window.useEffect = React.useEffect;
    window.useMemo = React.useMemo;
    window.useRef = React.useRef;
    window.useCallback = React.useCallback;
    window.useReducer = React.useReducer;

    var mounted = false;
    var rootEl = document.getElementById('root');
    var root = ReactDOM.createRoot(rootEl);
    window.render = function (el) {
      mounted = true;
      root.render(el);
    };

    var USER_SRC = ${JSON.stringify(trimmed)};
    try {
      var out = Babel.transform(USER_SRC, {
        presets: [['react', { runtime: 'classic' }], ['env', { targets: { esmodules: true } }]],
        filename: 'user.jsx',
      });
      // eslint-disable-next-line no-new-func
      (new Function(out.code))();
      // Auto-mount fallback: if the user defined App but didn't call render(), mount it.
      if (!mounted && typeof window.App === 'function') {
        window.render(React.createElement(window.App));
      }
      if (!mounted) {
        showError("Nothing rendered. Call render(<YourComponent />) or define a top-level App() component.");
      }
    } catch (err) {
      showError((err && err.message) || String(err));
    }
  }
  boot();
})();
</script>
</body>
</html>`
}
