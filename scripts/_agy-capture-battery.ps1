# Phase-1 battery driver: run `agy` across many prompt/response types under a PTY
# and dump a raw artifact per case. Sequential so output never interleaves.

$ErrorActionPreference = 'Stop'
$agy = (Get-Command agy).Source
$env:ANUBIS_ANTIGRAVITY_COMMAND = $agy

$root    = Join-Path $env:TEMP 'agy-capture'
$scratch = Join-Path $root 'scratch'
$harness = 'C:\Projects\anubis-workspaces\scripts\_agy-capture.mjs'
New-Item -ItemType Directory -Force -Path $scratch | Out-Null

# Fixture for tool-read case.
Set-Content -Path (Join-Path $scratch 'notes.txt') -Value 'The secret word is pineapple.' -NoNewline

# Each case: out filename + the agy args (everything after `--`).
$cases = @(
  @{ n = '02-markdown-list';  a = @('--add-dir', $scratch, '-p', 'List the three primary colors as a markdown bullet list. No other text.') },
  @{ n = '03-code-block';     a = @('--add-dir', $scratch, '-p', 'Write a Python hello world program in a fenced code block. No explanation.') },
  @{ n = '04-long-prose';     a = @('--add-dir', $scratch, '-p', 'Explain what a binary search tree is in about four sentences.') },
  @{ n = '05-tool-read';      a = @('--add-dir', $scratch, '--dangerously-skip-permissions', '-p', 'Read the file notes.txt in the working directory and tell me exactly what the secret word is.') },
  @{ n = '06-tool-listdir';   a = @('--add-dir', $scratch, '--dangerously-skip-permissions', '-p', 'List the files in the current working directory.') },
  @{ n = '07-tool-write';     a = @('--add-dir', $scratch, '--dangerously-skip-permissions', '-p', 'Create a file named hello.txt containing exactly the word banana, then confirm you are done.') },
  @{ n = '08-error-bad-model'; a = @('--add-dir', $scratch, '--model', 'definitely-not-a-real-model-xyz', '-p', 'hi') },
  @{ n = '09-special-chars';  a = @('--add-dir', $scratch, '-p', 'Output exactly this and nothing else: <Button>Click & go</Button>') }
)

foreach ($c in $cases) {
  $out = Join-Path $root ($c.n + '.json')
  Write-Host "=== $($c.n) ===" -ForegroundColor Cyan
  $argList = @($harness, '--out', $out, '--cwd', $scratch, '--') + $c.a
  & node @argList
}

Write-Host 'BATTERY DONE'
