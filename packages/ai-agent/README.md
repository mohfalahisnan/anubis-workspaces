# Anubis AI Agent

`@anubis/ai-agent` is the internal agent core used by the Anubis backend. It is
HTTP-oriented: the package exposes library APIs and the backend exposes routes.
It does not provide MCP tools, a CLI, standalone binaries, or packaged runtime
assets.

## Install

From the repository root:

```bash
pnpm install
pnpm --filter @anubis/ai-agent build
pnpm --filter @anubis/ai-agent typecheck
```

## Backend Usage

Use the Anubis backend routes:

- `GET /ai-agent/catalog`
- `POST /ai-agent/run`

`/ai-agent/run` collects agent stream events into a single HTTP JSON response with
the generated text, native agent session id, event list, and usage data when the
agent provides it.

## Runtime Commands

The package launches local agent commands directly:

- Codex: `codex app-server`
- Claude: `claude -p ... --output-format stream-json`

Override command names with environment variables when needed:

- `ANUBIS_CODEX_COMMAND`
- `ANUBIS_CLAUDE_COMMAND`

No binary manager is bundled with this package. The expected commands must already
be available in the backend process environment.
