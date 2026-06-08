import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'

interface BackendReadyMessage {
  type: 'backend-ready'
  url: string
  port: number
}

interface BackendRuntime {
  process: ChildProcess
  url: string
  stop: () => void
}

let backendRuntime: Promise<BackendRuntime> | undefined
const DEFAULT_BACKEND_PORT = '4317'

export function startBackend(appRoot: string, isDev: boolean, dataDir?: string, modelsDir?: string) {
  backendRuntime ??= new Promise<BackendRuntime>((resolve, reject) => {
    const command = isDev ? nodeCommand() : process.execPath
    const args = isDev
      ? [
          path.join(appRoot, 'node_modules/tsx/dist/cli.mjs'),
          path.join(appRoot, 'packages/backend/src/server.ts'),
        ]
      : [path.join(appRoot, 'packages/backend/dist/server.js')]

    const backendEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ANUBIS_BACKEND_HOST: '127.0.0.1',
      ANUBIS_BACKEND_PORT: process.env.ANUBIS_BACKEND_PORT ?? DEFAULT_BACKEND_PORT,
      FORCE_COLOR: '0',
    }
    if (dataDir) backendEnv.ANUBIS_DATA_DIR = dataDir
    if (modelsDir) backendEnv.ANUBIS_MODELS_DIR = modelsDir

    if (!isDev) {
      backendEnv.ELECTRON_RUN_AS_NODE = '1'
    }

    const child = spawn(command, args, {
      cwd: appRoot,
      env: backendEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let settled = false

    const timeout = setTimeout(() => {
      if (!settled) {
        child.kill()
        reject(new Error('Backend did not report a ready URL in time.'))
      }
    }, 15000)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk

      // Process whole lines; keep any trailing partial line buffered.
      const lines = stdout.split(/\r?\n/)
      stdout = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue

        const message = parseReadyMessage(line)
        if (message) {
          if (!settled) {
            settled = true
            clearTimeout(timeout)
            resolve({
              process: child,
              url: message.url,
              stop: () => child.kill(),
            })
          }
          // Don't also print the ready handshake JSON.
          continue
        }

        // Forward everything else (request logs, console.log) to the console
        // so backend activity is visible alongside stderr.
        console.log(`[backend] ${line}`)
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      console.error(`[backend] ${chunk.trimEnd()}`)
    })

    child.once('error', (error) => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        reject(error)
      }
    })

    child.once('exit', (code, signal) => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        reject(new Error(`Backend exited before it was ready. code=${code ?? 'null'} signal=${signal ?? 'null'}`))
      }
    })
  })

  return backendRuntime
}

function nodeCommand() {
  return process.env.npm_node_execpath ?? 'node'
}

function parseReadyMessage(line: string): BackendReadyMessage | undefined {
  try {
    const value = JSON.parse(line) as Partial<BackendReadyMessage>
    if (value.type === 'backend-ready' && typeof value.url === 'string' && typeof value.port === 'number') {
      return value as BackendReadyMessage
    }
  } catch {
    return undefined
  }

  return undefined
}
