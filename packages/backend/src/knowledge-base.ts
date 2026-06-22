import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import { createEngine, type KnowledgeEngine } from '@anubis/knowledge-lite'
import { getDataDir, getStack } from './services.js'

/* -----------------------------------------------------------
   Knowledge Base — in-process @anubis/knowledge-lite engine.

   Source of truth: <workspacePath>/knowledge/**.md
   Index (disposable): <dataDir>/knowledge-lite/<projectId>/index.db

   Agent-driven: the agent calls these routes on demand (see the
   anubis-core skill). Nothing is pre-injected.
   ----------------------------------------------------------- */

const KNOWLEDGE_SUBDIR = 'knowledge'

function knowledgeRoot(projectId: string): string {
  const workspace = getStack().projectWorkspaces.resolve(projectId)
  return join(workspace, KNOWLEDGE_SUBDIR)
}

function indexDbPath(projectId: string): string {
  return join(getDataDir(), 'knowledge-lite', projectId, 'index.db')
}

function engineFor(projectId: string): KnowledgeEngine {
  const sourceRoot = knowledgeRoot(projectId)
  mkdirSync(sourceRoot, { recursive: true })
  return createEngine({ sourceRoot, dbPath: indexDbPath(projectId) })
}

/* Serialize every engine invocation across the backend process: better-sqlite3
   writes the per-project index, and a concurrent rebuild would race on the temp
   file + rename. Cheap chain-of-promises; engine calls return in milliseconds. */
let engineQueue: Promise<unknown> = Promise.resolve()
function withEngineLock<T>(fn: () => T): Promise<T> {
  const next = engineQueue.then(fn, fn)
  engineQueue = next.catch(() => undefined)
  return next as Promise<T>
}

/** Delete a project's index dir. Safe if it never existed. */
export function deleteKnowledgeBaseForProject(projectId: string): void {
  const dir = join(getDataDir(), 'knowledge-lite', projectId)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

/* -----------------------------------------------------------
   HTTP routes
   ----------------------------------------------------------- */

const SearchBody = z.object({
  projectId: z.string().min(1),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
}).strict()

const IngestBody = z.object({
  projectId: z.string().min(1),
  full: z.boolean().optional(),
}).strict()

const SaveBody = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1),
  content: z.string(),
  force: z.boolean().optional(),
}).strict()

const UpdateBody = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1),
  content: z.string(),
}).strict()

const DeleteBody = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1),
}).strict()

const ProjectQuery = z.object({ projectId: z.string().min(1) })
const ReadQuery = z.object({ projectId: z.string().min(1), path: z.string().min(1) })

export const knowledgeBaseRoutes = new Hono()

knowledgeBaseRoutes.post('/search', async (c) => {
  const body = SearchBody.parse(await c.req.json())
  const out = await withEngineLock(() => engineFor(body.projectId).search({ query: body.query, limit: body.limit }))
  return c.json({ ok: true, query: out.query, results: out.results, lowConfidence: out.lowConfidence })
})

knowledgeBaseRoutes.post('/ingest', async (c) => {
  const body = IngestBody.parse(await c.req.json())
  const out = await withEngineLock(() => engineFor(body.projectId).ingest({ full: body.full }))
  return c.json({ ok: true, documents: out.documents, chunks: out.chunks })
})

knowledgeBaseRoutes.post('/save', async (c) => {
  const body = SaveBody.parse(await c.req.json())
  const out = await withEngineLock(() => engineFor(body.projectId).save({ path: body.path, content: body.content, force: body.force }))
  return c.json({ ok: true, path: out.path })
})

knowledgeBaseRoutes.post('/update', async (c) => {
  const body = UpdateBody.parse(await c.req.json())
  const out = await withEngineLock(() => engineFor(body.projectId).update({ path: body.path, content: body.content }))
  return c.json({ ok: true, path: out.path })
})

knowledgeBaseRoutes.post('/delete', async (c) => {
  const body = DeleteBody.parse(await c.req.json())
  const out = await withEngineLock(() => engineFor(body.projectId).delete({ path: body.path }))
  return c.json({ ok: true, path: out.path })
})

knowledgeBaseRoutes.get('/stats', async (c) => {
  const { projectId } = ProjectQuery.parse(Object.fromEntries(new URL(c.req.url).searchParams))
  const out = await withEngineLock(() => engineFor(projectId).stats())
  return c.json({ ok: true, ...out })
})

knowledgeBaseRoutes.get('/documents', async (c) => {
  const { projectId } = ProjectQuery.parse(Object.fromEntries(new URL(c.req.url).searchParams))
  const out = await withEngineLock(() => engineFor(projectId).listDocuments())
  return c.json({ ok: true, items: out.items })
})

knowledgeBaseRoutes.get('/tree', async (c) => {
  const { projectId } = ProjectQuery.parse(Object.fromEntries(new URL(c.req.url).searchParams))
  const out = await withEngineLock(() => engineFor(projectId).listFiles())
  return c.json({ ok: true, items: out.items })
})

knowledgeBaseRoutes.get('/read', async (c) => {
  const { projectId, path } = ReadQuery.parse(Object.fromEntries(new URL(c.req.url).searchParams))
  const out = await withEngineLock(() => engineFor(projectId).readFile({ path }))
  return c.json({ ok: true, path: out.path, content: out.content })
})
