export type CommandQueue = {
  /** Run a task after all previously-enqueued tasks settle. Errors are isolated. */
  run<T>(task: () => Promise<T>): Promise<T>
}

export function createCommandQueue(): CommandQueue {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(() => task())
      // Chain off a swallowed copy so one rejection never blocks later tasks.
      tail = result.then(() => undefined, () => undefined)
      return result
    },
  }
}
