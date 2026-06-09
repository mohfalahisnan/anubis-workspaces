import { spawn } from 'node:child_process'

/* -----------------------------------------------------------
   Spawn a CLI binary, capture stdout, parse it as JSON.

   Used to drive the `anubis-engine` and `anubis-extractor`
   binaries the user installs out-of-band and configures in
   Settings. stderr is captured and surfaced via a thrown Error
   on non-zero exit; partial stderr is also attached to the
   thrown error when stdout JSON parsing fails so the user can
   see what went wrong.
   ----------------------------------------------------------- */

export interface SpawnCliOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

export class SpawnCliError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
    public readonly stdout: string,
  ) {
    super(message)
    this.name = 'SpawnCliError'
  }
}

export async function spawnCliJson<T = unknown>(
  binary: string,
  args: string[],
  opts: SpawnCliOptions = {},
): Promise<T> {
  const { stdout, stderr, exitCode } = await spawnCli(binary, args, opts)
  if (exitCode !== 0) {
    throw new SpawnCliError(
      `${binary} exited ${exitCode}: ${stderr.trim() || '<no stderr>'}`,
      exitCode,
      stderr,
      stdout,
    )
  }
  try {
    return JSON.parse(stdout) as T
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new SpawnCliError(
      `${binary} stdout was not valid JSON: ${detail}`,
      exitCode,
      stderr,
      stdout,
    )
  }
}

export async function spawnCli(
  binary: string,
  args: string[],
  opts: SpawnCliOptions = {},
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(binary, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...(opts.env ?? {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (err) {
      reject(err)
      return
    }

    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr += chunk })

    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL')
        }, opts.timeoutMs)
      : null

    child.once('error', (err) => {
      if (timeout) clearTimeout(timeout)
      reject(err)
    })
    child.once('exit', (code) => {
      if (timeout) clearTimeout(timeout)
      resolve({ stdout, stderr, exitCode: code })
    })
  })
}
