// Prototype: reconstruct agy's text by EMULATING a terminal screen buffer,
// instead of regex-stripping escapes. agy lays out text spatially (CUF for
// spaces, CUP for line positioning), so only a screen model recovers it
// faithfully. Run over every captured artifact and diff vs the current stripper.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// --- current stripper (copy of terminal.ts) for comparison -----------------
function stripTerminalSequences(input, keepTrailing = false) {
  const noOsc = input.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
  const noAnsi = noOsc.replace(/\x1b[@-Z\\-_]|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[()][AB0]/g, '')
  const base = noAnsi.replace(/\r\n/g, '\n').replace(/\r/g, '')
  return keepTrailing ? base : base.replace(/[ \t\n]+$/g, '')
}

// --- prototype screen emulator ---------------------------------------------
function emulate(input) {
  const grid = [] // array of arrays of single chars
  let row = 0
  let col = 0
  const ensure = (r) => { while (grid.length <= r) grid.push([]) }
  const put = (ch) => {
    ensure(row)
    const line = grid[row]
    while (line.length < col) line.push(' ')
    line[col] = ch
    col++
  }
  let i = 0
  const n = input.length
  while (i < n) {
    const c = input[i]
    if (c === '\x1b') {
      const next = input[i + 1]
      if (next === '[') {
        // CSI: ESC [ params... final
        let j = i + 2
        let params = ''
        while (j < n && /[0-9;?]/.test(input[j])) { params += input[j]; j++ }
        const final = input[j]
        const nums = params.replace('?', '').split(';').map((x) => (x === '' ? NaN : parseInt(x, 10)))
        const arg = (v, d) => (v === undefined || Number.isNaN(v) ? d : v)
        switch (final) {
          case 'H': case 'f': {
            row = arg(nums[0], 1) - 1; col = arg(nums[1], 1) - 1; break
          }
          case 'A': row = Math.max(0, row - arg(nums[0], 1)); break
          case 'B': row = row + arg(nums[0], 1); break
          case 'C': col = col + arg(nums[0], 1); break
          case 'D': col = Math.max(0, col - arg(nums[0], 1)); break
          case 'J': if ((Number.isNaN(nums[0]) ? 0 : nums[0]) === 2) { grid.length = 0; } break
          case 'K': { ensure(row); grid[row].length = Math.min(grid[row].length, col); break }
          // 'm' (SGR), '?25h/l' modes, etc → ignore
          default: break
        }
        i = j + 1
        continue
      } else if (next === ']') {
        // OSC: ESC ] ... (BEL | ESC \)
        let j = i + 2
        while (j < n && input[j] !== '\x07' && input[j] !== '\x1b') j++
        if (input[j] === '\x1b' && input[j + 1] === '\\') j++
        i = j + 1
        continue
      } else if (next === '(' || next === ')') {
        i += 3; continue // charset designator
      } else {
        i += 2; continue // other ESC X
      }
    } else if (c === '\r') {
      col = 0; i++; continue
    } else if (c === '\n') {
      row++; i++; continue
    } else if (c === '\x07') {
      i++; continue
    } else {
      put(c); i++; continue
    }
  }
  // serialize: rstrip each row, join, then drop trailing blank lines.
  const lines = grid.map((r) => r.join('').replace(/[ \t]+$/g, ''))
  let text = lines.join('\n')
  text = text.replace(/\n+$/g, '').replace(/^\n+/g, '')
  return text
}

// --- run over all captured artifacts ---------------------------------------
const dir = process.argv[2] ?? join(process.env.TEMP ?? '/tmp', 'agy-capture')
const files = readdirSync(dir).filter((f) => /^\d.*\.json$/.test(f)).sort()
for (const f of files) {
  const art = JSON.parse(readFileSync(join(dir, f), 'utf8'))
  const old = stripTerminalSequences(art.raw)
  const neu = emulate(art.raw)
  const same = old === neu
  console.log('\n' + '='.repeat(78))
  console.log(`${f}  chunks=${art.chunkCount}  ${same ? '(identical)' : '*** DIFFERS ***'}`)
  console.log('--- CURRENT STRIPPER ---')
  console.log(JSON.stringify(old))
  if (!same) {
    console.log('--- SCREEN EMULATOR ---')
    console.log(JSON.stringify(neu))
  }
}
