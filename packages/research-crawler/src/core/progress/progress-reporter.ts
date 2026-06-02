export type ProgressReporter = {
  start(phase: string, total?: number): void
  update(phase: string, current: number, note?: string): void
  event(phase: string, message: string): void
  done(phase: string): void
}

export function silentReporter(): ProgressReporter {
  return {
    start() {},
    update() {},
    event() {},
    done() {}
  }
}

export function stderrReporter(throttleMs = 300): ProgressReporter {
  const lastEmit = new Map<string, number>()
  const totals = new Map<string, number | undefined>()

  function write(line: string): void {
    process.stderr.write(`${line}\n`)
  }

  function emit(phase: string, line: string, force: boolean): void {
    const now = Date.now()
    const last = lastEmit.get(phase) ?? 0
    if (!force && now - last < throttleMs) return
    lastEmit.set(phase, now)
    write(line)
  }

  return {
    start(phase, total) {
      totals.set(phase, total)
      const totalLabel = total === undefined ? '' : ` target=${total}`
      emit(phase, `[${phase}] started${totalLabel}`, true)
    },
    update(phase, current, note) {
      const total = totals.get(phase)
      const totalLabel = total === undefined ? '' : `/${total}`
      const noteLabel = note ? ` ${note}` : ''
      emit(phase, `[${phase}] ${current}${totalLabel}${noteLabel}`, false)
    },
    event(phase, message) {
      emit(phase, `[${phase}] ${message}`, true)
    },
    done(phase) {
      emit(phase, `[${phase}] done`, true)
      lastEmit.delete(phase)
      totals.delete(phase)
    }
  }
}
