import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process'

/**
 * Spawn a CLI handling the Windows `.cmd` / `.bat` shim quirk that
 * npm-installed binaries hit.
 *
 *   - Linux/macOS, or Windows .exe/extensionless: direct `spawn()`.
 *   - Windows .cmd / .bat:
 *       Direct spawn fails with EINVAL since Node's CVE-2024-27980 fix.
 *       `shell: true` is NOT a safe alternative: Node passes the args as
 *       a space-joined string with no per-arg quoting, so an argument
 *       containing spaces — like Claude's `-p "get out the plan mode"` —
 *       gets parsed by cmd.exe as multiple tokens. The CLI ends up
 *       seeing only the first word.
 *
 *       We instead invoke cmd.exe ourselves with one already-quoted
 *       command line, the canonical Windows pattern documented at
 *       https://learn.microsoft.com/.../cmd (the /s flag preserves the
 *       outer double-quote wrapping). `windowsVerbatimArguments: true`
 *       tells Node not to re-quote our line.
 */
export function spawnNpmShim(
  command: string,
  args: string[],
  options: SpawnOptions,
): ChildProcessWithoutNullStreams {
  if (process.platform === 'win32') {
    const dot = command.lastIndexOf('.')
    const ext = dot >= 0 ? command.slice(dot).toLowerCase() : ''
    if (ext === '.cmd' || ext === '.bat') {
      const innerCmdline =
        [command, ...args].map(quoteWindowsArg).join(' ')
      // cmd.exe /d /s /c "<inner>"
      //   /d → skip AutoRun
      //   /s → preserve outer quoting so /c sees the line verbatim
      //   /c → run and exit
      const wrapped = `"${innerCmdline}"`
      return spawn('cmd.exe', ['/d', '/s', '/c', wrapped], {
        ...options,
        windowsVerbatimArguments: true,
      }) as ChildProcessWithoutNullStreams
    }
  }
  return spawn(command, args, options) as ChildProcessWithoutNullStreams
}

/**
 * Quote a single argument for cmd.exe. Strategy:
 *
 *   1. If empty, return `""`.
 *   2. If the arg has no shell metachars or spaces, return it unmodified.
 *   3. Otherwise wrap in `"…"`. Inside the quoted span we follow the
 *      CommandLineToArgvW rules: a sequence of N backslashes followed by
 *      a `"` becomes 2N+1 backslashes + `"`; trailing backslashes are
 *      doubled. cmd.exe-special chars (`&|<>^()%!`) are also escaped
 *      with `^` outside the quoted region — but since we ARE wrapping
 *      in quotes, cmd.exe stops interpreting them. Quotes alone are the
 *      tricky bit.
 *
 * Exported for unit tests.
 */
export function quoteWindowsArg(arg: string): string {
  if (arg === '') return '""'
  // Anything that could be a shell metachar or whitespace forces quoting.
  if (!/[\s"&|<>^()%!,;=]/.test(arg)) return arg
  // Escape CommandLineToArgvW-significant chars: backslashes that
  // precede a `"` are doubled, the `"` is then prefixed with `\`.
  // Trailing backslashes are doubled so the closing `"` isn't escaped.
  let escaped = arg.replace(/(\\*)"/g, (_m, slashes: string) => `${slashes}${slashes}\\"`)
  escaped = escaped.replace(/(\\+)$/, (_m, slashes: string) => `${slashes}${slashes}`)
  return `"${escaped}"`
}
