#!/usr/bin/env node
// Benchmark Instagram profile capture across concurrency levels.
//
// Usage:
//   node scripts/benchmark-capture.mjs --usernames a,b,c [--posts-per-profile 30]
//                                     [--concurrencies 1,2,4,6]
//                                     [--public-port 9223]
//                                     [--chrome-origin http://127.0.0.1:9223]
//                                     [--scroll-interval-ms 1000]
//                                     [--initial-delay-ms 1200]
//                                     [--repeat 1]
//                                     [--output result/benchmark/<ts>.json]
//
// Pre-req: public Chrome already running. Easiest:
//   research-crawler open-chrome --profile public
//
// What it measures:
//   - wall time to capture N usernames at each concurrency level
//   - per-profile latency (min/median/max/avg)
//   - posts captured per profile, throughput (posts/sec, profiles/sec)

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const args = parseArgs(process.argv.slice(2))
const usernames = await resolveUsernames(args)
if (usernames.length === 0) {
  console.error('No usernames. Pass --usernames a,b,c or --from-file path.json.')
  process.exit(2)
}

const postsPerProfile = numberOr(args['posts-per-profile'], 30)
const concurrencies = parseList(args.concurrencies ?? '1,2,4,6').map((value) => Math.max(1, Math.floor(Number(value))))
const chromeOrigin = args['chrome-origin'] ?? `http://127.0.0.1:${args['public-port'] ?? 9223}`
const repeat = Math.max(1, Math.floor(numberOr(args.repeat, 1)))
const scrollIntervalMs = optionalNumber(args['scroll-interval-ms'])
const initialDelayMs = optionalNumber(args['initial-delay-ms'])
const outputPath = args.output ?? join(root, 'result', 'benchmark', `${nowSlug()}.json`)

const distEntry = pathToFileURL(join(root, 'dist', 'core', 'instagram-crawler.js')).href
let captureMod
try {
  captureMod = await import(distEntry)
} catch (error) {
  console.error('Failed to import dist build. Run "pnpm build" first.')
  console.error(error?.message ?? error)
  process.exit(2)
}
const captureInstagramData = captureMod.captureInstagramData

console.error(`[benchmark] usernames=${usernames.length} postsPerProfile=${postsPerProfile} repeat=${repeat}`)
console.error(`[benchmark] concurrencies=${concurrencies.join(',')} chromeOrigin=${chromeOrigin}`)

const runs = []
for (const concurrency of concurrencies) {
  for (let rep = 1; rep <= repeat; rep++) {
    const label = `c=${concurrency} run=${rep}/${repeat}`
    console.error(`\n[benchmark] starting ${label}`)
    const result = await runOnce({ concurrency, usernames })
    summarize(result, label)
    runs.push({ concurrency, repeat: rep, ...result })
  }
}

const summary = buildSummary(runs)
console.error('\n[benchmark] summary')
printTable(summary)

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, JSON.stringify({
  meta: {
    startedAt: new Date().toISOString(),
    usernames,
    postsPerProfile,
    concurrencies,
    repeat,
    chromeOrigin,
    scrollIntervalMs,
    initialDelayMs
  },
  runs,
  summary
}, null, 2), 'utf8')
console.error(`\n[benchmark] wrote ${outputPath}`)

async function runOnce({ concurrency, usernames }) {
  const queue = [...usernames]
  const perProfile = []
  const useNewTab = concurrency > 1
  const startedAt = Date.now()

  const worker = async () => {
    for (;;) {
      const username = queue.shift()
      if (!username) return
      const begin = Date.now()
      let posts = 0
      let ok = false
      let error
      try {
        const out = await captureInstagramData({
          username,
          chromeOrigin,
          maxResponses: postsPerProfile,
          openNewTab: useNewTab,
          ...(scrollIntervalMs ? { scrollIntervalMs } : {}),
          ...(initialDelayMs !== undefined ? { initialDelayMs } : {})
        })
        posts = out.output?.posts?.length ?? 0
        ok = out.ok && posts > 0
        if (!ok) error = out.error?.message ?? `no posts (ok=${out.ok})`
      } catch (err) {
        error = err?.message ?? String(err)
      }
      const ms = Date.now() - begin
      perProfile.push({ username, ms, posts, ok, ...(error ? { error } : {}) })
      const tag = ok ? 'ok' : 'fail'
      console.error(`  [${tag}] ${username} posts=${posts} ms=${ms}`)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  const wallMs = Date.now() - startedAt
  const totalPosts = perProfile.reduce((sum, entry) => sum + entry.posts, 0)
  const okCount = perProfile.filter((entry) => entry.ok).length
  return {
    wallMs,
    perProfile,
    totalPosts,
    okCount,
    failCount: perProfile.length - okCount,
    perProfileMs: stats(perProfile.map((entry) => entry.ms))
  }
}

function summarize(result, label) {
  const seconds = (result.wallMs / 1000).toFixed(2)
  console.error(`[benchmark] ${label} wall=${seconds}s posts=${result.totalPosts} ok=${result.okCount}/${result.perProfile.length} ` +
    `latency p50=${result.perProfileMs.p50}ms p95=${result.perProfileMs.p95}ms`)
}

function buildSummary(runs) {
  const byConcurrency = new Map()
  for (const run of runs) {
    if (!byConcurrency.has(run.concurrency)) byConcurrency.set(run.concurrency, [])
    byConcurrency.get(run.concurrency).push(run)
  }
  const rows = []
  for (const [concurrency, group] of byConcurrency) {
    const wallMs = avg(group.map((entry) => entry.wallMs))
    const totalPosts = avg(group.map((entry) => entry.totalPosts))
    const ok = avg(group.map((entry) => entry.okCount))
    const profiles = avg(group.map((entry) => entry.perProfile.length))
    const seconds = wallMs / 1000
    rows.push({
      concurrency,
      runs: group.length,
      avgWallSec: round(seconds, 2),
      avgProfiles: round(profiles, 2),
      avgOk: round(ok, 2),
      avgPosts: round(totalPosts, 2),
      profilesPerSec: round(profiles / seconds, 3),
      postsPerSec: round(totalPosts / seconds, 3),
      p50Ms: avg(group.map((entry) => entry.perProfileMs.p50)),
      p95Ms: avg(group.map((entry) => entry.perProfileMs.p95))
    })
  }
  rows.sort((a, b) => a.concurrency - b.concurrency)
  return rows
}

function printTable(rows) {
  const header = ['concurrency', 'runs', 'wallSec', 'profiles', 'ok', 'posts', 'prof/s', 'posts/s', 'p50ms', 'p95ms']
  const data = rows.map((r) => [r.concurrency, r.runs, r.avgWallSec, r.avgProfiles, r.avgOk, r.avgPosts, r.profilesPerSec, r.postsPerSec, r.p50Ms, r.p95Ms])
  const widths = header.map((h, i) => Math.max(h.length, ...data.map((row) => String(row[i]).length)))
  const fmt = (row) => row.map((cell, i) => String(cell).padStart(widths[i])).join('  ')
  console.error(fmt(header))
  for (const row of data) console.error(fmt(row))
}

function stats(values) {
  if (values.length === 0) return { p50: 0, p95: 0, min: 0, max: 0, avg: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: pick(0.5),
    p95: pick(0.95),
    avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length)
  }
}

function avg(values) {
  if (values.length === 0) return 0
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length)
}

function round(value, digits) {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      out[key] = true
    } else {
      out[key] = next
      i++
    }
  }
  return out
}

function parseList(value) {
  return String(value).split(',').map((part) => part.trim()).filter(Boolean)
}

function numberOr(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function optionalNumber(value) {
  if (value === undefined || value === true) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

async function resolveUsernames(args) {
  const set = new Set()
  if (typeof args.usernames === 'string') {
    for (const part of args.usernames.split(',')) {
      const trimmed = part.trim().replace(/^@/, '')
      if (trimmed) set.add(trimmed)
    }
  }
  if (typeof args['from-file'] === 'string') {
    const text = await readFile(resolve(args['from-file']), 'utf8')
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      throw new Error(`--from-file "${args['from-file']}" is not valid JSON.`)
    }
    for (const username of extractUsernames(payload)) set.add(username)
  }
  return [...set]
}

function extractUsernames(payload) {
  const out = []
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      if (typeof entry === 'string') out.push(entry.trim().replace(/^@/, ''))
      else if (entry && typeof entry === 'object' && typeof entry.username === 'string') {
        out.push(entry.username.trim().replace(/^@/, ''))
      }
    }
    return out
  }
  if (payload && typeof payload === 'object') {
    const output = payload.output
    const profiles = Array.isArray(output?.profiles) ? output.profiles : []
    for (const profile of profiles) {
      if (profile && typeof profile.username === 'string') out.push(profile.username.trim().replace(/^@/, ''))
    }
  }
  return out
}

function nowSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}
