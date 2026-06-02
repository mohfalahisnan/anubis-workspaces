import { copyFile, mkdir, rm, writeFile, chmod } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const buildDir = join(root, 'build', 'sea')
const releaseDir = join(root, 'release')
const bundlePath = join(buildDir, 'research-crawler.cjs')
const blobPath = join(buildDir, 'research-crawler.blob')
const seaConfigPath = join(buildDir, 'sea-config.json')
const exeName = process.platform === 'win32' ? 'research-crawler.exe' : 'research-crawler'
const exePath = join(releaseDir, exeName)

await rm(buildDir, { recursive: true, force: true })
await mkdir(buildDir, { recursive: true })
await mkdir(releaseDir, { recursive: true })

await build({
  entryPoints: [join(root, 'src', 'cli.ts')],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  outfile: bundlePath,
  logLevel: 'info'
})

await writeFile(
  seaConfigPath,
  JSON.stringify(
    {
      main: bundlePath,
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false
    },
    null,
    2
  ),
  'utf8'
)

run(process.execPath, ['--experimental-sea-config', seaConfigPath])
await copyFile(process.execPath, exePath)

if (process.platform === 'darwin') {
  run('codesign', ['--remove-signature', exePath])
}

const postjectArgs = [
  exePath,
  'NODE_SEA_BLOB',
  blobPath,
  '--sentinel-fuse',
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  '--overwrite'
]

if (process.platform === 'darwin') {
  postjectArgs.push('--macho-segment-name', 'NODE_SEA')
}

run(process.execPath, [join(root, 'node_modules', 'postject', 'dist', 'cli.js'), ...postjectArgs])

if (process.platform !== 'win32') {
  await chmod(exePath, 0o755)
}

if (process.platform === 'darwin') {
  run('codesign', ['--sign', '-', exePath])
}

console.log(`Packed ${exePath}`)

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }
}
