// Phase-1 capture harness for the Antigravity (`agy`) CLI.
//
// Mirrors packages/ai-agent/src/agents/antigravity/runner.ts: spawns `agy`
// under a pseudo-terminal (node-pty) at the same viewport size, buffers the raw
// rendered output (escape sequences intact), and dumps it to a JSON artifact so
// we can see EXACTLY what production parses. Run once per prompt.
//
// Usage:
//   node scripts/_agy-capture.mjs --out <file.json> --cwd <dir> -- <agy args...>
//
// Everything after `--` is passed verbatim to agy (so we can vary flags freely).

import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const require = createRequire(import.meta.url)
const pty = require('node-pty')

// --- arg parsing -----------------------------------------------------------
const argv = process.argv.slice(2)
const sep = argv.indexOf('--')
const head = sep === -1 ? argv : argv.slice(0, sep)
const agyArgs = sep === -1 ? [] : argv.slice(sep + 1)

function flag(name, def) {
  const i = head.indexOf(name)
  return i === -1 ? def : head[i + 1]
}
const outFile = flag('--out', null)
const cwd = flag('--cwd', process.cwd())
const command = process.env.ANUBIS_ANTIGRAVITY_COMMAND ?? 'agy'

if (!outFile) {
  console.error('missing --out <file.json>')
  process.exit(2)
}

// Same PTY geometry as runner.ts.
const PTY_COLS = 1000
const PTY_ROWS = 50

// Copy of stripTerminalSequences from terminal.ts so the artifact also shows
// what the CURRENT stripper produces (to compare against raw).
function stripTerminalSequences(input, keepTrailing = false) {
  const noOsc = input.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
  const noAnsi = noOsc.replace(/\x1b[@-Z\\-_]|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[()][AB0]/g, '')
  const base = noAnsi.replace(/\r\n/g, '\n').replace(/\r/g, '')
  return keepTrailing ? base : base.replace(/[ \t\n]+$/g, '')
}

const started = Date.now()
let buf = ''
const chunks = []

let proc
try {
  proc = pty.spawn(command, agyArgs, {
    name: 'xterm-256color',
    cols: PTY_COLS,
    rows: PTY_ROWS,
    cwd,
    env: process.env,
  })
} catch (e) {
  console.error('spawn failed:', e?.message ?? e)
  process.exit(3)
}

proc.onData((chunk) => {
  buf += chunk
  chunks.push({ t: Date.now() - started, data: chunk })
})

proc.onExit(({ exitCode, signal }) => {
  const stripped = stripTerminalSequences(buf)
  const artifact = {
    command,
    args: agyArgs,
    cwd,
    exitCode,
    signal: signal ?? null,
    elapsedMs: Date.now() - started,
    rawLength: buf.length,
    // raw with escapes visible (JSON-escaped) + base64 for byte-exact replay.
    raw: buf,
    rawBase64: Buffer.from(buf, 'utf8').toString('base64'),
    stripped,
    // timeline of chunks (helps see redraw / streaming behaviour).
    chunkCount: chunks.length,
    chunks,
  }
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, JSON.stringify(artifact, null, 2), 'utf8')
  console.log(
    `[captured] exit=${exitCode} sig=${signal ?? '-'} ${Date.now() - started}ms ` +
      `rawLen=${buf.length} chunks=${chunks.length} -> ${outFile}`,
  )
  process.exit(0)
})

// Safety net: agy print-timeout default is 5m. Cap the harness a bit beyond.
setTimeout(() => {
  try { proc.kill() } catch {}
}, 6 * 60 * 1000)
