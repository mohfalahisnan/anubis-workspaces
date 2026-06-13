interface HeadingMatch {
  name: string
  start: number
}

export function readSection(body: string, name: string): string | undefined {
  const sections = splitSections(body)
  const value = sections.get(name.toLowerCase())
  return value?.trim() || undefined
}

export function writeSections(
  body: string,
  updates: Record<string, string | undefined>,
): string {
  let next = body.trim()

  for (const [name, value] of Object.entries(updates)) {
    const key = name.toLowerCase()
    const range = sectionRanges(next).get(key)
    const replacement = value?.trim() ? `## ${name}\n\n${value.trim()}` : ''
    if (range) {
      next = `${next.slice(0, range.start)}${replacement}${next.slice(range.end)}`.trim()
      continue
    }
    if (replacement) next = `${next}${next ? '\n\n' : ''}${replacement}`
  }

  return next ? `${next.trim()}\n` : ''
}

function splitSections(body: string): Map<string, string> {
  const out = new Map<string, string>()
  const ranges = sectionRanges(body)
  for (const [name, range] of ranges) {
    const headingEnd = body.indexOf('\n', range.start)
    out.set(name, body.slice(headingEnd < 0 ? range.end : headingEnd + 1, range.end))
  }
  return out
}

function sectionRanges(body: string): Map<string, { start: number; end: number }> {
  const matches = findHeadings(body)
  const out = new Map<string, { start: number; end: number }>()
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index]!
    const end = matches[index + 1]?.start ?? body.length
    out.set(match.name.toLowerCase(), { start: match.start, end })
  }
  return out
}

function findHeadings(body: string): HeadingMatch[] {
  const matches: HeadingMatch[] = []
  let offset = 0
  let fence: { marker: '`' | '~'; length: number } | null = null

  for (const line of body.split(/(?<=\n)/)) {
    const content = line.replace(/\r?\n$/, '')
    const fenceMatch = content.match(/^ {0,3}(`{3,}|~{3,})/)

    if (fence) {
      if (
        fenceMatch &&
        fenceMatch[1]![0] === fence.marker &&
        fenceMatch[1]!.length >= fence.length &&
        /^ {0,3}(`+|~+)\s*$/.test(content)
      ) {
        fence = null
      }
      offset += line.length
      continue
    }

    if (fenceMatch) {
      const token = fenceMatch[1]!
      fence = { marker: token[0] as '`' | '~', length: token.length }
      offset += line.length
      continue
    }

    const heading = content.match(/^##[ \t]+(.+?)[ \t]*$/)
    if (heading) matches.push({ name: heading[1]!.trim(), start: offset })
    offset += line.length
  }

  return matches
}
