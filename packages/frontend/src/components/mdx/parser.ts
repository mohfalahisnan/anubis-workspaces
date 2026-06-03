export type ComponentName =
  | 'Buttons'
  | 'Button'
  | 'DataTable'
  | 'KeyValueList'
  | 'LineChart'
  | 'HtmlPreview'
  | 'ReactPreview'

const WHITELIST: ReadonlySet<string> = new Set<ComponentName>([
  'Buttons',
  'Button',
  'DataTable',
  'KeyValueList',
  'LineChart',
  'HtmlPreview',
  'ReactPreview',
])

export type Segment =
  | { kind: 'markdown'; text: string }
  | { kind: 'component'; name: ComponentName; propsRaw: string; childrenRaw: string }

/**
 * Split a message body into interleaved markdown and component segments.
 * Whitelisted tags only — anything else flows through as markdown text.
 * Unclosed whitelisted tag at end of input ⇒ flushed as trailing markdown
 * (streaming-tolerance hook: the next chunk completes it).
 */
export function splitMdxSource(source: string): Segment[] {
  const segments: Segment[] = []
  let mdStart = 0
  let i = 0
  const n = source.length

  const flushMd = (end: number) => {
    if (end > mdStart) segments.push({ kind: 'markdown', text: source.slice(mdStart, end) })
  }

  while (i < n) {
    if (source[i] !== '<') {
      i++
      continue
    }
    let j = i + 1
    const nameStart = j
    while (j < n && /[A-Za-z]/.test(source[j]!)) j++
    const tagName = source.slice(nameStart, j)
    if (!WHITELIST.has(tagName)) {
      i = j
      continue
    }
    const openEnd = findOpenTagEnd(source, j)
    if (openEnd === -1) {
      flushMd(n)
      mdStart = n
      return segments
    }
    const selfClosing = source[openEnd - 1] === '/'
    const propsRaw = source.slice(j, selfClosing ? openEnd - 1 : openEnd).trim()

    if (selfClosing) {
      flushMd(i)
      segments.push({ kind: 'component', name: tagName as ComponentName, propsRaw, childrenRaw: '' })
      i = openEnd + 1
      mdStart = i
      continue
    }

    const closeIdx = findMatchingClose(source, openEnd + 1, tagName)
    if (closeIdx === -1) {
      flushMd(n)
      mdStart = n
      return segments
    }
    flushMd(i)
    segments.push({
      kind: 'component',
      name: tagName as ComponentName,
      propsRaw,
      childrenRaw: source.slice(openEnd + 1, closeIdx),
    })
    i = closeIdx + ('</' + tagName + '>').length
    mdStart = i
  }

  flushMd(n)
  return segments
}

function findOpenTagEnd(source: string, from: number): number {
  let i = from
  const n = source.length
  while (i < n) {
    const c = source[i]
    if (c === '"') {
      i++
      while (i < n && source[i] !== '"') {
        if (source[i] === '\\' && i + 1 < n) i += 2
        else i++
      }
      if (i >= n) return -1
      i++
    } else if (c === '{') {
      let depth = 1
      i++
      while (i < n && depth > 0) {
        if (source[i] === '"') {
          i++
          while (i < n && source[i] !== '"') {
            if (source[i] === '\\' && i + 1 < n) i += 2
            else i++
          }
          if (i >= n) return -1
          i++
        } else if (source[i] === '{') {
          depth++
          i++
        } else if (source[i] === '}') {
          depth--
          i++
        } else {
          i++
        }
      }
      if (depth !== 0) return -1
    } else if (c === '>') {
      return i
    } else {
      i++
    }
  }
  return -1
}

function findMatchingClose(source: string, from: number, tagName: string): number {
  const openMarker = '<' + tagName
  const closeMarker = '</' + tagName + '>'
  let i = from
  let depth = 1
  const n = source.length
  while (i < n) {
    if (source.startsWith(closeMarker, i)) {
      depth--
      if (depth === 0) return i
      i += closeMarker.length
    } else if (
      source.startsWith(openMarker, i) &&
      i + openMarker.length < n &&
      /[\s/>]/.test(source[i + openMarker.length]!)
    ) {
      depth++
      i += openMarker.length
    } else {
      i++
    }
  }
  return -1
}
