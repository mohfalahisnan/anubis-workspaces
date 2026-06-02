import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import net from 'node:net'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pnpmCli = process.env.npm_execpath

if (!pnpmCli) {
  console.error('Could not locate pnpm from npm_execpath.')
  process.exit(1)
}

const children = new Set()
let shuttingDown = false

function runPnpm(args, options = {}) {
  const child = spawn(process.execPath, [pnpmCli, ...args], {
    cwd: root,
    env: { ...process.env, ...options.env },
    stdio: options.stdio ?? 'inherit',
    windowsHide: true,
  })

  children.add(child)
  child.once('exit', () => children.delete(child))

  return child
}

function stopAll() {
  if (shuttingDown) return

  shuttingDown = true
  for (const child of children) {
    child.kill()
  }
}

process.once('SIGINT', () => {
  stopAll()
  process.exit(130)
})

process.once('SIGTERM', () => {
  stopAll()
  process.exit(143)
})

const ANSI_RE = /\[[0-9;]*[A-Za-z]/g

function waitForFrontendReady(child) {
  return new Promise((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for frontend dev server to become ready.'))
    }, 30000)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      output += chunk

      if (output.replace(ANSI_RE, '').match(/ready in\s+\d/i)) {
        clearTimeout(timeout)
        resolve()
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
    })

    child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Frontend dev server exited before it was ready. code=${code ?? 'null'}`))
    })
  })
}

function buildElectron() {
  return new Promise((resolve, reject) => {
    const child = runPnpm([
      'exec',
      'vite',
      'build',
      '--config',
      'vite.config.ts',
      '--mode',
      'development',
    ])

    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Electron build failed. code=${code ?? 'null'}`))
      }
    })
  })
}

function buildBackendPackages() {
  return new Promise((resolve, reject) => {
    const child = runPnpm([
      '--filter',
      '@anubis/research-crawler',
      '--filter',
      '@anubis/ai-agent',
      '--filter',
      '@anubis/conversation',
      'build',
    ])

    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Backend package build failed. code=${code ?? 'null'}`))
      }
    })
  })
}

function getFreePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer()

    server.once('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : undefined

      server.close(() => {
        if (port) {
          resolve(port)
        } else {
          reject(new Error('Could not reserve a frontend port.'))
        }
      })
    })
  })
}

async function main() {
  const frontendPort = await getFreePort()
  const frontend = runPnpm([
    '--dir',
    'packages/frontend',
    'exec',
    'vite',
    '--host',
    '127.0.0.1',
    '--port',
    String(frontendPort),
    '--strictPort',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const frontendUrl = `http://127.0.0.1:${frontendPort}`

  await Promise.all([
    waitForFrontendReady(frontend),
    buildBackendPackages().then(() => buildElectron()),
  ])

  console.log(`\n[desktop] Renderer: ${frontendUrl}`)

  const electron = runPnpm([
    'exec',
    'electron',
    'apps/desktop/dist-electron/main/index.js',
  ], {
    env: {
      VITE_DEV_SERVER_URL: frontendUrl,
    },
  })

  electron.once('exit', (code, signal) => {
    stopAll()
    if (signal) {
      process.exit(1)
    }

    process.exit(code ?? 0)
  })
}

main().catch((error) => {
  console.error(error)
  stopAll()
  process.exit(1)
})
