import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDataDir, getStack } from './services.js'
import { spawnCliJson } from './spawn-cli.js'

/* -----------------------------------------------------------
   Knowledge Base — drives the `anubis-engine` CLI as the
   per-Project searchable corpus.

   See:
   - docs/adr/0001-engine-state-under-anubis-datadir.md
   - docs/adr/0002-knowledge-base-workdir-equals-workspace-root.md

   Engine state co-locates under <dataDir>/engine via
   ANUBIS_DB_PATH; each Project's workspace folder is passed
   verbatim as `-w <workspacePath>` so the whole project IS
   the corpus, filtered by a `.anubisignore` at the workspace
   root.
   ----------------------------------------------------------- */

const ANUBISIGNORE_FILENAME = '.anubisignore'

const DEFAULT_ANUBISIGNORE = `# Auto-created by Anubis on first index.
# The engine does NOT honour .gitignore — only this file.
# Add patterns to skip files/folders during indexing.

# Version control
.git/

# Dependencies
node_modules/
vendor/
.pnpm-store/

# Build outputs
dist/
build/
target/
out/
.next/
.turbo/
.cache/

# Lockfiles (large, low information)
*.lock
pnpm-lock.yaml
package-lock.json
yarn.lock

# Anubis-generated sidecars (text already covered via the source file)
*.anubis.txt

# Logs and temp
*.log
.tmp/
tmp/

# IDE / OS
.vscode/
.idea/
.DS_Store
Thumbs.db
`

function engineDataDir(): string {
  return join(getDataDir(), 'engine')
}

function engineDbPath(): string {
  return join(engineDataDir(), 'anubis.db')
}

function engineWorkdirsRoot(): string {
  return join(engineDataDir(), 'workdirs')
}

function getEngineBinary(): string {
  const path = getStack().appConfig.get().engineBinaryPath
  if (!path) {
    throw new Error(
      'Knowledge Base engine binary not configured. Set the path in Settings → External binaries.',
    )
  }
  return path
}

function getProjectWorkdir(projectId: string): string {
  const project = getStack().projects.findById(projectId)
  if (!project) throw new Error(`Project ${projectId} not found.`)
  if (!project.workdir) {
    throw new Error(
      `Project "${project.name}" has no workdir. Set a workspace path on the project before using its Knowledge Base.`,
    )
  }
  if (!existsSync(project.workdir)) {
    throw new Error(`Project workdir does not exist on disk: ${project.workdir}`)
  }
  return project.workdir
}

/**
 * Match the engine's WorkdirId: first 16 hex chars of
 * sha256(canonical_path). The engine uses `fs::canonicalize`,
 * Node's closest equivalent is `realpathSync.native`.
 */
function computeWorkdirId(workdir: string): string {
  let canonical = workdir
  try {
    canonical = realpathSync.native(workdir)
  } catch {
    // Fall back to the raw path; the engine will reject if it disagrees,
    // and deletion cleanup falls back to meta.json scanning anyway.
  }
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

function ensureEngineDirs(): void {
  mkdirSync(engineDataDir(), { recursive: true })
  mkdirSync(engineWorkdirsRoot(), { recursive: true })
}

/**
 * Write the default `.anubisignore` if none exists at the workspace
 * root. Returns true if a file was created, false if one was already
 * there. Idempotent.
 */
function ensureAnubisIgnore(workdir: string): boolean {
  const target = join(workdir, ANUBISIGNORE_FILENAME)
  if (existsSync(target)) return false
  writeFileSync(target, DEFAULT_ANUBISIGNORE)
  return true
}

function engineEnv(): NodeJS.ProcessEnv {
  ensureEngineDirs()
  return { ANUBIS_DB_PATH: engineDbPath() }
}

/* Serialize every engine invocation across the whole backend process.
   The engine writes to the per-workdir sqlite + FTS lock files, and a
   second concurrent call observes "database is locked" / `LockBusy`
   on tantivy. Cheap chain-of-promises is enough — the engine returns
   in milliseconds for status calls, and indexing is intentionally
   single-threaded. */
let engineQueue: Promise<unknown> = Promise.resolve()

function withEngineLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = engineQueue.then(fn, fn)
  // Swallow rejection so the next caller still proceeds.
  engineQueue = next.catch(() => undefined)
  return next
}

async function callEngine<T = unknown>(
  subcommand: string,
  args: string[],
): Promise<T> {
  const binary = getEngineBinary()
  return withEngineLock(() =>
    spawnCliJson<T>(binary, [subcommand, ...args], { env: engineEnv() }),
  )
}

/* -----------------------------------------------------------
   Public service methods
   ----------------------------------------------------------- */

export interface IndexInput {
  projectId: string
  /** Optional sub-paths to index. Defaults to the full workdir. */
  paths?: string[]
}

export async function indexProject(input: IndexInput): Promise<{
  workdirId: string
  createdIgnoreFile: boolean
  indexed: string[]
}> {
  const workdir = getProjectWorkdir(input.projectId)
  const createdIgnoreFile = ensureAnubisIgnore(workdir)
  const workdirId = computeWorkdirId(workdir)

  const targets = input.paths && input.paths.length > 0 ? input.paths : [workdir]
  const indexed: string[] = []

  for (const target of targets) {
    const sub = isDirectory(target) ? 'index-folder' : 'index-file'
    await callEngine(sub, ['-w', workdir, '-p', target])
    indexed.push(target)
  }

  return { workdirId, createdIgnoreFile, indexed }
}

function isDirectory(p: string): boolean {
  try { return statSync(p).isDirectory() } catch { return false }
}

export async function searchKnowledgeBase(input: {
  projectId: string
  query: string
  limit?: number
  depth?: number
}): Promise<{ raw: unknown; hits: Array<{ chunkId: string; docId: string; path: string; score?: number; snippet: string }> }> {
  const workdir = getProjectWorkdir(input.projectId)
  const args = ['-w', workdir, '-q', input.query]
  if (input.limit !== undefined) args.push('-l', String(input.limit))
  if (input.depth !== undefined) args.push('-d', String(input.depth))
  const raw = await callEngine<unknown>('search', args)
  return { raw, hits: normalizeHits(raw) }
}

export async function contextPack(input: {
  projectId: string
  query: string
  budget?: number
  includeGraph?: boolean
}): Promise<{ raw: unknown; text: string }> {
  const workdir = getProjectWorkdir(input.projectId)
  const args = ['-w', workdir, '-q', input.query]
  if (input.budget !== undefined) args.push('-b', String(input.budget))
  if (input.includeGraph === false) args.push('--no-include-graph')
  const raw = await callEngine<unknown>('context-pack', args)
  return { raw, text: extractText(raw) }
}

export async function getStats(projectId: string): Promise<{
  raw: unknown
  documentCount: number
  chunkCount: number
  entityCount: number
  edgeCount: number
  lastIndexedAt?: number
}> {
  const workdir = getProjectWorkdir(projectId)
  const raw = await callEngine<unknown>('get-index-stats', ['-w', workdir])
  return {
    raw,
    documentCount: numericField(raw, ['document_count', 'documents', 'docs']) ?? 0,
    chunkCount: numericField(raw, ['chunk_count', 'chunks']) ?? 0,
    entityCount: numericField(raw, ['entity_count', 'entities']) ?? 0,
    edgeCount: numericField(raw, ['edge_count', 'edges']) ?? 0,
    lastIndexedAt: readWorkdirLastUsed(workdir),
  }
}

export async function listDocuments(projectId: string): Promise<{
  raw: unknown
  items: Array<{ id: string; path: string; chunkCount?: number; indexedAt?: number }>
}> {
  const workdir = getProjectWorkdir(projectId)
  const raw = await callEngine<unknown>('list-documents', ['-w', workdir])
  return { raw, items: normalizeDocuments(raw) }
}

export interface GraphNodeOut {
  id: string
  docId: string
  filename: string
  content: string
  page?: number
  degree: number
  docClass?: string
  chunkSignal?: string
}

export interface GraphEdgeOut {
  src: string
  dst: string
  weight: number
  edgeType: string
  reason?: string
}

export async function getGraphOverview(input: {
  projectId: string
  limit?: number
}): Promise<{ raw: unknown; nodes: GraphNodeOut[]; edges: GraphEdgeOut[] }> {
  const workdir = getProjectWorkdir(input.projectId)
  const args = ['-w', workdir]
  if (input.limit !== undefined) args.push('-l', String(input.limit))
  const raw = await callEngine<unknown>('get-graph-overview', args)
  return { raw, nodes: normalizeGraphNodes(raw), edges: normalizeGraphEdges(raw) }
}

export async function getGraphNeighborhood(input: {
  projectId: string
  chunkId: string
  depth?: number
  limit?: number
}): Promise<{ raw: unknown; nodes: GraphNodeOut[]; edges: GraphEdgeOut[] }> {
  const workdir = getProjectWorkdir(input.projectId)
  const args = ['-w', workdir, '-c', input.chunkId]
  if (input.depth !== undefined) args.push('-d', String(input.depth))
  if (input.limit !== undefined) args.push('-l', String(input.limit))
  const raw = await callEngine<unknown>('get-graph-neighborhood', args)
  return { raw, nodes: normalizeGraphNodes(raw), edges: normalizeGraphEdges(raw) }
}

/**
 * Delete the engine state for a Project's workdir. Safe to call
 * even if the engine has never seen this workdir or the binary
 * is unconfigured. Matches by canonical_path in the per-workdir
 * meta.json (the engine's authoritative key) so it works after
 * the workspace folder has been moved or deleted.
 */
export function deleteKnowledgeBaseForWorkdir(workdir: string | undefined): void {
  if (!workdir) return
  const root = engineWorkdirsRoot()
  if (!existsSync(root)) return

  let canonical: string
  try {
    canonical = realpathSync.native(workdir)
  } catch {
    canonical = workdir
  }
  const target = normalize(canonical).toLowerCase()

  for (const entry of readdirSync(root)) {
    const dir = join(root, entry)
    const metaPath = join(dir, 'meta.json')
    if (!existsSync(metaPath)) continue
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { canonical_path?: string }
      const known = typeof meta.canonical_path === 'string' ? normalize(meta.canonical_path).toLowerCase() : null
      if (known === target) {
        rmSync(dir, { recursive: true, force: true })
        return
      }
    } catch {
      // Ignore malformed meta files
    }
  }
}

function readWorkdirLastUsed(workdir: string): number | undefined {
  const id = computeWorkdirId(workdir)
  const metaPath = join(engineWorkdirsRoot(), id, 'meta.json')
  if (!existsSync(metaPath)) return undefined
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { last_used?: string }
    if (typeof meta.last_used === 'string') {
      const ts = Date.parse(meta.last_used)
      return Number.isFinite(ts) ? ts : undefined
    }
  } catch {}
  return undefined
}

/* -----------------------------------------------------------
   Output normalization — the engine's exact JSON shape can
   evolve, so we pluck common conventions and surface `raw`
   for the frontend to fall back on.
   ----------------------------------------------------------- */

function normalizeHits(raw: unknown): Array<{ chunkId: string; docId: string; path: string; score?: number; snippet: string }> {
  const items = pickArray(raw, ['hits', 'results', 'chunks', 'items']) ?? []
  return items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      chunkId: stringField(item, ['chunk_id', 'chunkId', 'id']) ?? '',
      docId: stringField(item, ['doc_id', 'docId', 'document_id']) ?? '',
      path: stringField(item, ['path', 'doc_path', 'document_path']) ?? '',
      score: numericField(item, ['score', 'similarity']),
      snippet: stringField(item, ['snippet', 'text', 'content', 'preview']) ?? '',
    }))
}

function normalizeGraphNodes(raw: unknown): GraphNodeOut[] {
  const items = pickArray(raw, ['nodes']) ?? []
  return items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      id: stringField(item, ['chunk_id', 'chunkId', 'id']) ?? '',
      docId: stringField(item, ['doc_id', 'docId', 'document_id']) ?? '',
      filename: stringField(item, ['filename', 'path', 'file']) ?? '',
      content: stringField(item, ['content', 'text', 'snippet']) ?? '',
      page: numericField(item, ['page']),
      degree: numericField(item, ['degree']) ?? 0,
      docClass: stringField(item, ['doc_class', 'docClass']),
      chunkSignal: stringField(item, ['chunk_signal', 'chunkSignal']),
    }))
    .filter((n) => n.id)
}

function normalizeGraphEdges(raw: unknown): GraphEdgeOut[] {
  const items = pickArray(raw, ['edges']) ?? []
  return items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      src: stringField(item, ['src_chunk', 'srcChunk', 'src', 'source']) ?? '',
      dst: stringField(item, ['dst_chunk', 'dstChunk', 'dst', 'target']) ?? '',
      weight: numericField(item, ['weight']) ?? 0,
      edgeType: stringField(item, ['edge_type', 'edgeType', 'type']) ?? '',
      reason: stringField(item, ['edge_reason', 'reason']),
    }))
    .filter((e) => e.src && e.dst)
}

function normalizeDocuments(raw: unknown): Array<{ id: string; path: string; chunkCount?: number; indexedAt?: number }> {
  const items = pickArray(raw, ['documents', 'items', 'docs']) ?? []
  return items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      id: stringField(item, ['id', 'doc_id', 'documentId']) ?? '',
      path: stringField(item, ['path', 'doc_path']) ?? '',
      chunkCount: numericField(item, ['chunk_count', 'chunks']),
      indexedAt: numericField(item, ['indexed_at', 'updated_at']),
    }))
}

function extractText(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    return stringField(obj, ['text', 'context', 'pack', 'output']) ?? JSON.stringify(raw)
  }
  return ''
}

function pickArray(raw: unknown, keys: string[]): unknown[] | null {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    for (const key of keys) {
      const v = obj[key]
      if (Array.isArray(v)) return v
    }
  }
  return null
}

function stringField(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === 'string') return v
  }
  return undefined
}

function numericField(obj: unknown, keys: string[]): number | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const o = obj as Record<string, unknown>
  for (const key of keys) {
    const v = o[key]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return undefined
}

/* -----------------------------------------------------------
   HTTP routes
   ----------------------------------------------------------- */

const IndexBody = z.object({
  projectId: z.string().min(1),
  paths: z.array(z.string().min(1)).optional(),
}).strict()

const SearchBody = z.object({
  projectId: z.string().min(1),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
  depth: z.number().int().min(0).max(3).optional(),
}).strict()

const ContextPackBody = z.object({
  projectId: z.string().min(1),
  query: z.string().min(1),
  budget: z.number().int().min(100).max(50_000).optional(),
  includeGraph: z.boolean().optional(),
}).strict()

const ProjectQuery = z.object({
  projectId: z.string().min(1),
})

const GraphQuery = z.object({
  projectId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
})

const NeighborhoodQuery = z.object({
  projectId: z.string().min(1),
  chunkId: z.string().min(1),
  depth: z.coerce.number().int().min(1).max(3).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
})

export const knowledgeBaseRoutes = new Hono()

knowledgeBaseRoutes.post('/index', async (c) => {
  const body = IndexBody.parse(await c.req.json())
  const out = await indexProject(body)
  return c.json({ ok: true, ...out })
})

knowledgeBaseRoutes.post('/search', async (c) => {
  const body = SearchBody.parse(await c.req.json())
  const out = await searchKnowledgeBase(body)
  return c.json({ ok: true, query: body.query, hits: out.hits, raw: out.raw })
})

knowledgeBaseRoutes.post('/context-pack', async (c) => {
  const body = ContextPackBody.parse(await c.req.json())
  const out = await contextPack(body)
  return c.json({ ok: true, query: body.query, text: out.text, raw: out.raw })
})

knowledgeBaseRoutes.get('/stats', async (c) => {
  const { projectId } = ProjectQuery.parse(Object.fromEntries(new URL(c.req.url).searchParams))
  const out = await getStats(projectId)
  return c.json({
    ok: true,
    documentCount: out.documentCount,
    chunkCount: out.chunkCount,
    entityCount: out.entityCount,
    edgeCount: out.edgeCount,
    lastIndexedAt: out.lastIndexedAt,
    raw: out.raw,
  })
})

knowledgeBaseRoutes.get('/documents', async (c) => {
  const { projectId } = ProjectQuery.parse(Object.fromEntries(new URL(c.req.url).searchParams))
  const out = await listDocuments(projectId)
  return c.json({ ok: true, items: out.items, raw: out.raw })
})

knowledgeBaseRoutes.get('/graph', async (c) => {
  const { projectId, limit } = GraphQuery.parse(Object.fromEntries(new URL(c.req.url).searchParams))
  const out = await getGraphOverview({ projectId, limit })
  return c.json({ ok: true, nodes: out.nodes, edges: out.edges, raw: out.raw })
})

knowledgeBaseRoutes.get('/graph/neighborhood', async (c) => {
  const { projectId, chunkId, depth, limit } = NeighborhoodQuery.parse(Object.fromEntries(new URL(c.req.url).searchParams))
  const out = await getGraphNeighborhood({ projectId, chunkId, depth, limit })
  return c.json({ ok: true, nodes: out.nodes, edges: out.edges, raw: out.raw })
})

knowledgeBaseRoutes.get('/ignore-file', async (c) => {
  const { projectId } = ProjectQuery.parse(Object.fromEntries(new URL(c.req.url).searchParams))
  const workdir = getProjectWorkdir(projectId)
  const target = join(workdir, ANUBISIGNORE_FILENAME)
  const exists = existsSync(target)
  const content = exists ? readFileSync(target, 'utf8') : ''
  return c.json({ ok: true, exists, path: target, content })
})
