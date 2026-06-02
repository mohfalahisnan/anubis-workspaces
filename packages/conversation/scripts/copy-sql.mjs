import { mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'src/db/migrations'
const DST = 'dist/db/migrations'

mkdirSync(DST, { recursive: true })
for (const entry of readdirSync(SRC)) {
  const s = join(SRC, entry)
  if (statSync(s).isFile() && entry.endsWith('.sql')) {
    copyFileSync(s, join(DST, entry))
  }
}
console.log('copied SQL migrations →', DST)
