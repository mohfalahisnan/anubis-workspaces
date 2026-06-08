// Self-healing pre-dev checks. Runs before `pnpm dev` and fixes the two
// states pnpm leaves us in when it skips native install scripts:
//   1. better-sqlite3's .node binary is compiled for the wrong ABI
//      (`pnpm build` leaves Electron-ABI; dev needs system-Node ABI).
//   2. node_modules/electron is missing its `path.txt` and/or the
//      downloaded Chromium dist (pnpm ignores Electron's postinstall).
// All checks are no-ops when state already matches.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function probeSqlite() {
  try {
    const Database = require('better-sqlite3')
    new Database(':memory:').close()
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err?.message ?? String(err) }
  }
}

function rebuildSqliteForNode() {
  const sqliteDir = path.dirname(require.resolve('better-sqlite3/package.json'))
  const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js')
  return spawnSync(process.execPath, [nodeGyp, 'rebuild', '--release'], {
    stdio: 'inherit',
    cwd: sqliteDir,
    env: {
      ...process.env,
      npm_config_build_from_source: 'true',
    },
  })
}

function ensureSqlite() {
  const first = probeSqlite()
  if (first.ok) return
  if (!/NODE_MODULE_VERSION/i.test(first.message)) {
    console.error('[ensure-dev] better-sqlite3 failed for a non-ABI reason:')
    console.error(first.message)
    process.exit(1)
  }
  console.log('[ensure-dev] better-sqlite3 ABI mismatch — rebuilding for system Node…')
  const r = rebuildSqliteForNode()
  if (r.error) {
    console.error(`[ensure-dev] failed to start better-sqlite3 rebuild: ${r.error.message}`)
  }
  if (r.status !== 0) process.exit(r.status ?? 1)
  const second = probeSqlite()
  if (!second.ok) {
    console.error('[ensure-dev] rebuild succeeded but better-sqlite3 still fails:')
    console.error(second.message)
    process.exit(1)
  }
}

function ensureElectron() {
  const electronDir = path.join(repoRoot, 'node_modules', 'electron')
  if (!existsSync(electronDir)) return // not installed at all; nothing to do
  const pathTxt = path.join(electronDir, 'path.txt')
  const distDir = path.join(electronDir, 'dist')
  const installScript = path.join(electronDir, 'install.js')
  if (existsSync(pathTxt) && existsSync(distDir)) return
  if (!existsSync(installScript)) {
    console.error('[ensure-dev] electron package is broken (no install.js); reinstall electron manually.')
    process.exit(1)
  }
  console.log('[ensure-dev] electron binary not initialised — running its postinstall…')
  const r = spawnSync(process.execPath, [installScript], { stdio: 'inherit', cwd: electronDir })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

ensureSqlite()
ensureElectron()
