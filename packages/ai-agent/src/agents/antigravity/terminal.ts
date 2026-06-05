/**
 * Strip terminal control sequences from PTY output.
 *
 * The Antigravity CLI (`agy`) only emits its response to a TTY, so we run it
 * under a pseudo-terminal (node-pty) and scrape the rendered text. Print mode
 * renders the answer once (no re-draw), wrapped in setup/teardown escapes:
 *
 *   \x1b[?25l \x1b[2J \x1b[H  <answer>  \x1b]0;title\x07 \x1b[?25h
 *
 * We remove OSC sequences (window-title sets, which embed the binary path),
 * CSI/charset escapes, then normalize CR/LF and trim.
 */
export function stripTerminalSequences(input: string): string {
  const noOsc = input.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
  const noAnsi = noOsc.replace(/\x1b[@-Z\\-_]|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[()][AB0]/g, '')
  // CRLF → LF, drop any bare CR (overwrite carriage returns), trim trailing ws.
  return noAnsi.replace(/\r\n/g, '\n').replace(/\r/g, '').replace(/[ \t\n]+$/g, '')
}
