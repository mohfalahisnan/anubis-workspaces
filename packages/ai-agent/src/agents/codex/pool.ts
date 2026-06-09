import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { killProcessTree } from '../process-tree.js'

export interface PoolKey {
  workspaceId: string
  sessionId: string
  extraEnv?: Record<string, string>
}

export interface CodexPoolOpts {
  spawn: (key: PoolKey) => ChildProcessWithoutNullStreams | Promise<ChildProcessWithoutNullStreams>
  idleMs: number
}

interface Slot {
  child: ChildProcessWithoutNullStreams
  evictTimer?: NodeJS.Timeout
}

export class CodexPool {
  private slots = new Map<string, Slot>()

  constructor(private opts: CodexPoolOpts) {}

  private k(key: PoolKey): string {
    return `${key.workspaceId}::${key.sessionId}`
  }

  async acquire(key: PoolKey): Promise<ChildProcessWithoutNullStreams> {
    const k = this.k(key)
    const cur = this.slots.get(k)
    if (cur) {
      if (cur.evictTimer) {
        clearTimeout(cur.evictTimer)
      }
      cur.evictTimer = undefined
      return cur.child
    }

    const child = await this.opts.spawn(key)
    this.slots.set(k, { child })
    return child
  }

  release(key: PoolKey): void {
    const k = this.k(key)
    const slot = this.slots.get(k)
    if (!slot) return
    if (slot.evictTimer) {
      clearTimeout(slot.evictTimer)
    }
    slot.evictTimer = setTimeout(() => this.evict(key), this.opts.idleMs)
  }

  evict(key: PoolKey): void {
    const k = this.k(key)
    const slot = this.slots.get(k)
    if (!slot) return
    try {
      try {
        slot.child.stdin?.end()
      } catch {
        // ignore
      }
      // Tree-kill: the app-server runs under a cmd.exe shim on Windows, so a
      // bare kill() would orphan it and leak the process across turns.
      killProcessTree(slot.child.pid)
    } catch {
      // ignore
    }
    this.slots.delete(k)
  }

  async dispose(): Promise<void> {
    const children: ChildProcessWithoutNullStreams[] = []
    for (const [k, slot] of this.slots) {
      children.push(slot.child)
      const parts = k.split('::')
      this.evict({ workspaceId: parts[0]!, sessionId: parts[1]! })
    }

    await Promise.all(
      children.map(
        (c) =>
          new Promise<void>((resolve) => {
            if (c.exitCode !== null || c.killed) return resolve()
            const done = () => resolve()
            c.once('exit', done)
            c.once('close', done)
            setTimeout(done, 1500).unref()
          }),
      ),
    )
  }
}
