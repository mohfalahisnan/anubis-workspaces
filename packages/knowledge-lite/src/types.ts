export interface Chunk {
  sourcePath: string
  chunkIndex: number
  heading: string | null
  startLine: number
  endLine: number
  tokenEstimate: number
  contentHash: string
  terms: Map<string, number>
  text?: string
}

export interface DocumentRow {
  path: string
  title: string
  contentHash: string
  updatedAt: string
}

export interface SearchResult {
  source: string
  startLine: number
  endLine: number
  heading: string | null
  rawScore: number
  coverage: number
  score: number
  excerpt: string
}

export class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ValidationError' }
}
export class IndexStoreError extends Error {
  constructor(message: string) { super(message); this.name = 'IndexStoreError' }
}
export class FileSystemError extends Error {
  constructor(message: string) { super(message); this.name = 'FileSystemError' }
}
