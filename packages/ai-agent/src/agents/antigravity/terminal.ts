/**
 * Reconstruct the Antigravity CLI's text by EMULATING a terminal screen.
 *
 * `agy` only renders to a TTY, so we run it under a pseudo-terminal (node-pty)
 * and scrape the bytes. Crucially, `agy` lays out text *spatially*: it encodes
 * runs of spaces as cursor-forward escapes (`ESC[<n>C`) and line breaks as
 * absolute cursor-position jumps (`ESC[<row>;<col>H`). A regex that merely
 * deletes escapes therefore loses those spaces and newlines, gluing words and
 * lines together. The only faithful way to recover the text is to do what a real
 * terminal does — maintain a cursor over a 2-D character grid and replay the
 * stream into it — then read the grid back as text.
 *
 * Captured evidence and the escape vocabulary live in
 * docs/antigravity/agy-output-reference.md.
 */

/** Render a raw PTY byte stream to the text a terminal would display. */
export function renderTerminalOutput(input: string): string {
  const grid: string[][] = []
  let row = 0
  let col = 0

  const ensureRow = (r: number) => {
    while (grid.length <= r) grid.push([])
  }
  const put = (ch: string) => {
    if (row < 0) row = 0
    if (col < 0) col = 0
    ensureRow(row)
    const line = grid[row]!
    while (line.length < col) line.push(' ')
    line[col] = ch
    col++
  }

  const n = input.length
  let i = 0
  while (i < n) {
    const c = input[i]!
    if (c === '\x1b') {
      const next = input[i + 1]
      if (next === '[') {
        // CSI: ESC [ <params> <final>
        let j = i + 2
        let params = ''
        while (j < n && /[0-9;?]/.test(input[j]!)) {
          params += input[j]
          j++
        }
        const final = input[j]
        const nums = params
          .replace('?', '')
          .split(';')
          .map((x) => (x === '' ? NaN : parseInt(x, 10)))
        // Default a missing/blank numeric parameter. NOTE: Number.isNaN(undefined)
        // is false, so an absent param must be checked explicitly.
        const arg = (v: number | undefined, d: number) =>
          v === undefined || Number.isNaN(v) ? d : v
        switch (final) {
          case 'H': // CUP — move to row;col (line breaks are encoded this way)
          case 'f':
            row = arg(nums[0], 1) - 1
            col = arg(nums[1], 1) - 1
            break
          case 'A': // CUU
            row = Math.max(0, row - arg(nums[0], 1))
            break
          case 'B': // CUD
            row = row + arg(nums[0], 1)
            break
          case 'C': // CUF — cursor forward (runs of spaces are encoded this way)
            col = col + arg(nums[0], 1)
            break
          case 'D': // CUB
            col = Math.max(0, col - arg(nums[0], 1))
            break
          case 'J': // ED — erase display; 2J resets the screen
            if (arg(nums[0], 0) === 2) grid.length = 0
            break
          case 'K': // EL — erase line from cursor to end
            ensureRow(row)
            grid[row]!.length = Math.min(grid[row]!.length, col)
            break
          // SGR ('m'), private modes ('?25h/l'), etc. carry no text — ignore.
          default:
            break
        }
        i = j + 1
        continue
      }
      if (next === ']') {
        // OSC: ESC ] ... terminated by BEL or ST (ESC \). Carries the window
        // title (the agy binary path) — no answer text.
        let j = i + 2
        while (j < n && input[j] !== '\x07' && input[j] !== '\x1b') j++
        if (input[j] === '\x1b' && input[j + 1] === '\\') j++
        i = j + 1
        continue
      }
      if (next === '(' || next === ')') {
        i += 3 // charset designator: ESC ( X
        continue
      }
      i += 2 // other ESC X
      continue
    }
    if (c === '\r') {
      col = 0
      i++
      continue
    }
    if (c === '\n') {
      row++
      i++
      continue
    }
    if (c === '\x07') {
      i++
      continue
    }
    put(c)
    i++
  }

  // Read the grid back: right-trim each row, drop leading/trailing blank rows.
  const lines = grid.map((r) => r.join('').replace(/[ \t]+$/g, ''))
  return lines.join('\n').replace(/^\n+/, '').replace(/\n+$/, '')
}

/**
 * The suffix of `next` past its longest common prefix with `prev`.
 *
 * Streaming emits partial deltas by re-rendering the whole screen on every PTY
 * chunk and diffing against what was already emitted. Because later chunks can
 * repaint earlier rows (CUP), a simple length-slice is wrong — diff from the
 * first divergent character instead.
 */
export function diffAppended(prev: string, next: string): string {
  let k = 0
  const max = Math.min(prev.length, next.length)
  while (k < max && prev[k] === next[k]) k++
  return next.slice(k)
}
