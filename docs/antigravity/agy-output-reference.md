# Antigravity (`agy`) print-mode output — captured reference

> Phase-1 evidence for fixing the antigravity parser. Every claim here is backed
> by a real capture from `agy` **v1.0.7** on Windows, taken under a PTY that
> mirrors `runner.ts` exactly (1000×50, `xterm-256color`). Raw artifacts live in
> [`packages/ai-agent/tests/agents/antigravity/fixtures/agy-raw/`](../../packages/ai-agent/tests/agents/antigravity/fixtures/agy-raw/).
>
> Reproduce: `scripts/_agy-capture.mjs` (single case) and
> `scripts/_agy-capture-battery.ps1` (the whole battery). Compare stripper vs.
> screen-emulator with `scripts/_agy-emulate.mjs`.

## TL;DR — why the parser is inaccurate

1. **`agy` has no structured output.** `agy --help` lists no `--output-format`
   flag. Print mode (`-p`) emits **plain text rendered to a TTY** — never JSON,
   JSON-lines, or Anthropic stream-json. The parser's entire JSON / stream-json /
   tool-event machinery (`parser.ts` `ingest`, `parseAntigravityOutput`,
   `types.ts`) matches output shapes that **real `agy` never produces**.
2. **`agy` lays out text spatially with cursor-movement escapes**, not just
   literal characters:
   - **`ESC[<n>C`** (Cursor Forward / CUF) encodes **runs of spaces**.
   - **`ESC[<row>;<col>H`** (Cursor Position / CUP) encodes **line breaks**
     (and blank lines, by jumping multiple rows).
   The current `stripTerminalSequences` **deletes** these escapes, so the spaces
   and newlines they represent **vanish** — words get glued together
   (`Hello,World!`) and lines get glued together (`following file:* notes.txt`).
   This is the primary accuracy bug.
3. **Setup/teardown escapes appear mid-stream**, not just at the boundaries.
   The OSC window-title + show-cursor teardown can land *between two words* of the
   answer (see case 03), so "OSC title ⇒ end of output" is a false assumption.
4. **Output streams across multiple PTY chunks** for longer/agentic answers
   (cases 03, 05, 08). The runner's plain-text delta logic
   (`cleaned.slice(lastCleanedText.length)`) is fragile because cleaning is lossy
   *and* later chunks repaint earlier rows via CUP.
5. **A bad `--model` exits 0.** `agy` silently falls back to the default model
   instead of erroring (case 08), so `exitCode !== 0` is not a reliable error
   signal.
6. **Tool use is not machine-readable in print mode.** Tools are woven into the
   final markdown (file links like `[notes.txt](file:///…)`, an optional
   `### Summary of Work` section, and interleaved reasoning narration). There are
   **no discrete `tool_use` / `tool_result` markers** to parse.

**Validated fix direction:** replace the regex stripper with a **minimal terminal
screen-buffer emulator** (cursor + 2D grid). Proven in `scripts/_agy-emulate.mjs`:
identical to today's stripper on all 6 cases it already handled, and strictly
more accurate on the 5 it broke. Dependency-free.

---

## The CLI surface (`agy --help`, v1.0.7)

```
-p, --print, --prompt   Run a single prompt non-interactively and print the response
-i, --prompt-interactive
-c, --continue          Continue the most recent conversation
--conversation <id>     Resume a previous conversation by ID
--add-dir <dir>         Add a directory to the workspace (repeatable)
--model <model>         Model for the current CLI session
--dangerously-skip-permissions
--sandbox
--print-timeout <dur>   default 5m0s
--log-file <path>
subcommands: changelog, help, install, models, plugin/plugins, update
```

There is **no `--output-format`**. `build-args.ts` already documents this and omits
it by default — good. The dead JSON paths are in `parser.ts` / `runner.ts`, not
`build-args.ts`.

Note: piping `agy`'s stdout (no TTY) yields **empty output** — confirmed by
`agy models | Out-String` hanging/printing nothing. PTY capture is mandatory.

## Escape vocabulary actually emitted

| Sequence | Name | Meaning in `agy` output | Correct handling |
|---|---|---|---|
| `ESC[?25l` / `ESC[?25h` | DECTCEM | hide / show cursor | ignore |
| `ESC[2J` | ED(2) | erase display (frame setup) | clear screen buffer |
| `ESC[m` | SGR reset | styling reset | ignore (styling) |
| `ESC[H` | CUP (no args) | cursor home (row 1, col 1) | move cursor to 0,0 |
| `ESC[<r>;<c>H` | CUP | **move to row r, col c → encodes line breaks** | reposition cursor in grid |
| `ESC[<n>C` | CUF | **cursor forward n → encodes n spaces** | advance column n |
| `ESC]0;…BEL` | OSC | window title = the agy binary path | strip (skip to BEL/ST) |
| `\r` / `\n` | CR / LF | literal carriage-return / line-feed | col←0 / row←row+1 |

Not yet observed but worth handling defensively: `ESC[<n>D` (CUB), `ESC[<n>A/B`
(CUU/CUD), `ESC[K` (EL). The emulator handles them.

**Gotcha that bit the prototype:** `Number.isNaN(undefined) === false`. When CUP
omits the column (`ESC[H`), `nums[1]` is `undefined`; guarding with
`Number.isNaN` alone leaves `col = undefined - 1 = NaN`, silently dropping the
whole first line. Guard with `v === undefined || Number.isNaN(v)`.

---

## Captured cases

For each: the prompt, the raw PTY bytes (escapes shown as `ESC`), what the
**current stripper** produces, and the **correct** text (screen emulator). `Δ`
marks where they differ.

### 01 — plain text · 1 chunk · exit 0
Prompt: `What is 2+2? Reply with just the number.`
Raw: `ESC[?25l ESC[2J ESC[m ESC[H 4\r\n ESC]0;…agy.exe BEL ESC[?25h`
Stripper = Emulator = `4` ✓ (simple single-line answers already work)

### 02 — markdown bullet list · 1 chunk
Prompt: list the three primary colors.
Stripper = Emulator = `- Red\n- Yellow\n- Blue` ✓ (literal `\r\n` between items)

### 03 — fenced code block · 2 chunks · **Δ space lost**
Raw (key fragment): `print("Hello, ESC[1C ESC]0;…BEL ESC[?25h World!")`
- Stripper: `` ```python\nprint("Hello,World!")\n``` `` ← **space gone**
- Emulator: `` ```python\nprint("Hello, World!")\n``` `` ✓
The space between `Hello,` and `World!` was emitted as `ESC[1C` (CUF 1), and the
OSC teardown landed mid-word.

### 04 — long prose · 1 chunk
Single paragraph, all literal characters. Stripper = Emulator ✓.

### 05 — tool use: read file · 2 chunks · **Δ blank line lost**
Prompt used `--dangerously-skip-permissions` to read `notes.txt`.
- Stripper: `…is **pineapple**.### Summary of Work\n1. …` ← **`.###` glued**
- Emulator: `…is **pineapple**.\n\n### Summary of Work\n1. …` ✓
The section break was a CUP jump (`ESC[3;1H`), not `\r\n`. Note the answer
contains a markdown file link `[notes.txt](file:///…)` and a trailing
`### Summary of Work` — there are **no tool_use/tool_result events**.

### 06 — tool use: list dir · 1 chunk · **Δ line break lost**
- Stripper: `…following file:* [notes.txt](…) (29 bytes)` ← **`:*` glued**
- Emulator: `…following file:\n\n* [notes.txt](…) (29 bytes)` ✓ (CUP `ESC[3;1H`)

### 07 — tool use: write file · 1 chunk · **Δ line break lost**
- Stripper: ``…the word `banana`.The task is completed.`` ← **`.The` glued**
- Emulator: ``…the word `banana`.\n\nThe task is completed.`` ✓ (CUP `ESC[3;1H`)

### 08 — streaming + reasoning narration · 6 chunks · **Δ two breaks lost**
A "hi" prompt with a bogus `--model` (exited **0**, fell back to default model).
`agy` streamed reasoning lines ("I should check…", "I will inspect…") **before**
the answer, then positioned the greeting across rows with `ESC[6;1H` and
`ESC[10;1H`.
- Stripper: `…assistant. I see…` and `…pineapple.`)How can I help…` ← breaks lost
- Emulator: `…assistant.\n\nI see…` and `…pineapple.`)\n\nHow can I help…` ✓

### 09 — literal angle brackets / ampersand · 1 chunk
Prompt forces `<Button>Click & go</Button>`. Stripper = Emulator ✓.
Relevant because this text flows downstream into the **frontend MDX parser**
(`packages/frontend/src/components/mdx/parser.ts`), which only treats a fixed
whitelist of tags as components — `<Button>` IS whitelisted, so accurate spacing
here matters end-to-end.

### 10 — nested markdown list · 1 chunk
`- Fruits\n  - apple\n  - banana\n- Vegetables\n  - carrot`. Stripper = Emulator ✓.
**Indentation is literal spaces**, not CUF — so CUF only shows up situationally.

### 11 — markdown table · 1 chunk
Full pipe table, literal `\r\n` between rows. Stripper = Emulator ✓.

---

## What this means for the refactor (Phase 2)

1. **Render, don't strip.** Implement a small screen-buffer emulator (the proven
   `emulate()` in `scripts/_agy-emulate.mjs`) and make `stripTerminalSequences`'s
   callers use it. Keep a thin compatibility wrapper if other code depends on the
   name.
2. **Delete the JSON fiction.** `agy` never emits JSON. Collapse `parser.ts` to
   "screen-render the PTY buffer → one assistant text block". Remove (or quarantine
   behind the unused `--output-format` opt-in) the stream-json / tool-event /
   `AntigravityJson` machinery and its tests, replacing them with fixture-driven
   tests over the real captures.
3. **Fix streaming deltas.** Because later chunks repaint earlier rows, compute
   partial deltas by re-rendering the whole buffer each chunk and diffing the
   rendered text (longest-common-prefix), not by slicing lossy cleaned text.
4. **Stop trusting `exitCode` alone** for errors (bad model exits 0). Treat empty
   rendered output / known error banners as the failure signal.
5. **Tool calls aren't events.** Don't expect `tool_call` / `tool_result` from
   print mode; the final text already narrates them. Either drop those emitter
   paths for antigravity or leave them dormant.

Fixtures to drive Phase 2 tests: the 11 `*.json` artifacts each carry `raw`
(byte-exact), the current `stripped`, and metadata — assert the new renderer maps
each `raw` to the **correct** column documented above.
