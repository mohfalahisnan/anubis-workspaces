import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConversationService, type ConversationStack } from '@anubis/conversation'
import { getBuiltinSkillRoots } from '@anubis/ai-agent'
import { WSServer } from './extension/ws-server.js'
import { JobQueue } from './extension/job-queue.js'
import { ensureExtensionInstalled } from './extension/install.js'

let stack: ConversationStack | null = null
let wsServer: WSServer | null = null
let jobQueue: JobQueue | null = null
let startupPromise: Promise<void> | null = null

const BACKEND_VERSION = '0.1.0'

export function getStack(): ConversationStack {
  if (stack) return stack
  const dataDir = process.env.ANUBIS_DATA_DIR ?? join(tmpdir(), 'anubis')
  const builtin = getBuiltinSkillRoots()
  stack = createConversationService({
    dataDir,
    skillRoots: {
      autoInject: builtin.autoInject,
      optIn: builtin.optIn,
      user: join(dataDir, 'skills'),
    },
  })
  return stack
}

/**
 * Idempotent startup: binds the extension WS server and remembers the
 * bound port in app config. Routes that depend on the WS being up
 * should `await ensureExtensionStarted()`.
 */
export async function ensureExtensionStarted(): Promise<void> {
  if (jobQueue) return
  if (startupPromise) return startupPromise
  startupPromise = (async () => {
    const s = getStack()
    const cfg = s.appConfig.get()
    const secret = cfg.extensionSecret
    if (!secret) throw new Error('extensionSecret missing — AppConfigService should have generated it')

    // Copy the bundled extension into a stable path under ANUBIS_DATA_DIR
    // so the user always has a fixed "Load unpacked" target.
    const dataDirRoot = process.env.ANUBIS_DATA_DIR ?? join(tmpdir(), 'anubis')
    const bundleDir = resolveExtensionBundleDir()
    const installResult = ensureExtensionInstalled({
      bundleDir,
      destDir: join(dataDirRoot, 'extension'),
    })
    if (installResult.installed) {
      console.log(`[extension] installed bundle v${installResult.installedVersion} to ${installResult.destDir}`)
    } else if (installResult.installedVersion === null) {
      // bundleDir was missing — nothing landed in dataDir/extension. Make
      // this visible so a freshly-cloned checkout that never ran
      // `pnpm --filter @anubis/extension build` doesn't silently leave
      // the user pointing Chrome at a non-existent path.
      console.warn(
        `[extension] bundle not found at ${bundleDir}. ` +
        `Run \`pnpm --filter @anubis/extension build\` (or \`pnpm dev\` after a fresh git pull).`,
      )
    }

    const ws = new WSServer({
      secret,
      backendVersion: BACKEND_VERSION,
      portRange: [47891, 47900],
    })
    const port = await ws.start()
    s.appConfig.update({ extensionPort: port })
    const q = new JobQueue({
      send: (frame) => ws.send(frame),
      isConnected: () => ws.isConnected(),
    })
    ws.onFrame = (frame) => q.handleFrame(frame)
    ws.onConnect = ({ pairedAt }) => { s.appConfig.update({ extensionPairedAt: pairedAt }) }
    ws.onDisconnect = () => { q.disconnectAll() }
    wsServer = ws
    jobQueue = q
  })()
  return startupPromise
}

function resolveExtensionBundleDir(): string {
  // 1. When packaged: Electron passes the resource path explicitly.
  if (process.env.ANUBIS_EXTENSION_BUNDLE_DIR) return process.env.ANUBIS_EXTENSION_BUNDLE_DIR
  // 2. Dev: monorepo path relative to this file at runtime. From
  //    packages/backend/dist/services.js → ../../../extension/dist.
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..', '..', 'extension', 'dist')
}

export function getExtensionWS(): WSServer | null {
  return wsServer
}
export function getJobQueue(): JobQueue | null {
  return jobQueue
}

export async function shutdownStack(): Promise<void> {
  if (wsServer) {
    await wsServer.stop()
    wsServer = null
    jobQueue = null
    startupPromise = null
  }
  if (!stack) return
  await stack.shutdown()
  stack = null
}
