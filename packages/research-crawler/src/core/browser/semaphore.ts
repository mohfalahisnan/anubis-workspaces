export type Semaphore = {
  /** Resolves when a slot is free; call the returned fn to release it. */
  acquire(): Promise<() => void>
  readonly active: number
  readonly max: number
}

export function createSemaphore(max: number): Semaphore {
  const limit = Math.max(1, Math.floor(max))
  let active = 0
  const waiters: Array<() => void> = []

  const release = () => {
    active--
    const next = waiters.shift()
    if (next) next()
  }

  return {
    acquire() {
      return new Promise<() => void>((resolve) => {
        const grant = () => {
          active++
          let released = false
          resolve(() => {
            if (released) return
            released = true
            release()
          })
        }
        if (active < limit) grant()
        else waiters.push(grant)
      })
    },
    get active() { return active },
    get max() { return limit },
  }
}
