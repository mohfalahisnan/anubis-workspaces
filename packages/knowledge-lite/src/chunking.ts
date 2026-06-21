import { createHash } from 'node:crypto'
import type { EngineConfig } from './config.js'
import type { Chunk } from './types.js'
import { cleanHeading, estimateTokens, normalizeTerms } from './text.js'

export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

interface Section {
  heading: string
  startLine: number
  endLine: number
  lines: string[]
}

export function splitSections(lines: string[], fileName: string): Section[] {
  const headings: Array<[number, string]> = []
  lines.forEach((line, index) => {
    const heading = cleanHeading(line)
    if (heading) headings.push([index, heading])
  })
  if (lines.length === 0) {
    return [{ heading: fileName, startLine: 1, endLine: 1, lines: [] }]
  }
  if (headings.length === 0) {
    return [{ heading: fileName, startLine: 1, endLine: lines.length, lines }]
  }
  const sections: Section[] = []
  if (headings[0][0] > 0) {
    const prefix = lines.slice(0, headings[0][0])
    if (prefix.some(line => line.trim() !== '')) {
      sections.push({ heading: fileName, startLine: 1, endLine: headings[0][0], lines: prefix })
    }
  }
  headings.forEach(([startIndex, heading], idx) => {
    const endIndex = idx + 1 < headings.length ? headings[idx + 1][0] : lines.length
    sections.push({
      heading,
      startLine: startIndex + 1,
      endLine: endIndex,
      lines: lines.slice(startIndex, endIndex),
    })
  })
  return sections
}

type Block = [number, number, string[]] // startLine, endLine, lines

function paragraphBlocks(section: Section): Block[] {
  const { lines, startLine } = section
  const blocks: Block[] = []
  let blockLines: string[] = []
  let blockStart: number | null = null
  let lastLine = startLine
  lines.forEach((line, offset) => {
    const lineNumber = startLine + offset
    if (line.trim() === '') {
      if (blockLines.length) {
        blockLines.push(line)
        blocks.push([blockStart as number, lineNumber, [...blockLines]])
        blockLines = []
        blockStart = null
      }
      return
    }
    if (blockStart === null) blockStart = lineNumber
    blockLines.push(line)
    lastLine = lineNumber
  })
  if (blockLines.length) blocks.push([blockStart as number, lastLine, [...blockLines]])
  if (blocks.length === 0) blocks.push([section.startLine, section.endLine, lines])
  return blocks
}

function makeChunk(
  sourcePath: string,
  chunkIndex: number,
  heading: string | null,
  startLine: number | null,
  endLine: number | null,
  text: string,
): Chunk {
  const fullText = heading ? `${heading}\n${text}` : text
  const terms = new Map<string, number>()
  for (const term of normalizeTerms(fullText)) {
    terms.set(term, (terms.get(term) ?? 0) + 1)
  }
  const start = startLine || 1
  return {
    sourcePath,
    chunkIndex,
    heading,
    startLine: start,
    endLine: endLine || start,
    tokenEstimate: estimateTokens(text),
    contentHash: sha256Text(text),
    terms,
    text,
  }
}

export function chunksForFile(sourcePath: string, text: string, config: EngineConfig): Chunk[] {
  const lines = text.split('\n')
  const fileName = sourcePath.split('/').pop() ?? sourcePath
  const chunks: Chunk[] = []
  let chunkIndex = 0
  for (const section of splitSections(lines, fileName)) {
    const sectionText = section.lines.join('\n')
    if (estimateTokens(sectionText) <= config.chunkMaxTokens) {
      chunks.push(makeChunk(sourcePath, chunkIndex++, section.heading, section.startLine, section.endLine, sectionText))
      continue
    }
    let currentLines: string[] = []
    let currentStart: number | null = null
    let currentEnd: number | null = null
    for (const [blockStart, blockEnd, blockLines] of paragraphBlocks(section)) {
      const proposed = [...currentLines, ...blockLines]
      if (currentLines.length && estimateTokens(proposed.join('\n')) > config.chunkTargetTokens) {
        chunks.push(makeChunk(sourcePath, chunkIndex++, section.heading, currentStart, currentEnd, currentLines.join('\n')))
        currentLines = [...blockLines]
        currentStart = blockStart
        currentEnd = blockEnd
      } else {
        if (currentStart === null) currentStart = blockStart
        currentLines.push(...blockLines)
        currentEnd = blockEnd
      }
    }
    if (currentLines.length) {
      chunks.push(makeChunk(sourcePath, chunkIndex++, section.heading, currentStart, currentEnd, currentLines.join('\n')))
    }
  }
  return chunks
}
