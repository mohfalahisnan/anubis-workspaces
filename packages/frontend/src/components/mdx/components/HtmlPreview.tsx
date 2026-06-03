import {
  PREVIEW_BASE_CSS,
  PREVIEW_RUNTIME_SCRIPT,
  SandboxedFrame,
  useMemoizedSrcdoc,
} from './sandboxed-frame'

export interface HtmlPreviewProps {
  html: string
  height?: number
  maxHeight?: number
}

/**
 * Render arbitrary HTML inside a sandboxed iframe. The model writes a
 * fragment (or full document) as the children of <HtmlPreview>; the iframe
 * auto-sizes to its content. Use `anubis.fetch(path, init)` inside a
 * <script> to call the Anubis backend.
 */
export function HtmlPreview({ html, height, maxHeight }: HtmlPreviewProps) {
  const srcdoc = useMemoizedSrcdoc(() => buildHtmlDoc(html), [html])
  return (
    <SandboxedFrame
      srcdoc={srcdoc}
      height={height}
      maxHeight={maxHeight}
      label='HTML preview'
    />
  )
}

function buildHtmlDoc(userHtml: string): string {
  const trimmed = userHtml.trim()
  // If the user already provided a full document, splice the runtime in.
  // Otherwise wrap their fragment in a minimal shell.
  if (/<html[\s>]/i.test(trimmed) || /<!doctype/i.test(trimmed)) {
    return injectRuntime(trimmed)
  }
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>${PREVIEW_BASE_CSS}</style>
<script>${PREVIEW_RUNTIME_SCRIPT}</script>
</head>
<body>
${trimmed}
</body>
</html>`
}

function injectRuntime(doc: string): string {
  const runtime = `<style>${PREVIEW_BASE_CSS}</style><script>${PREVIEW_RUNTIME_SCRIPT}</script>`
  if (/<\/head>/i.test(doc)) {
    return doc.replace(/<\/head>/i, runtime + '</head>')
  }
  if (/<body[^>]*>/i.test(doc)) {
    return doc.replace(/<body([^>]*)>/i, `<body$1>${runtime}`)
  }
  return runtime + doc
}
