# Conversations + AI agent

Threaded chats with Claude/Codex agents, message persistence, SSE event stream, and one-shot agent runs.

## Endpoints

| Method | Path | Purpose | Source |
| --- | --- | --- | --- |
| POST | `/conversations` | Create conversation | `conversation.ts:30` |
| GET | `/conversations` | List (with limit + archived filter) | `conversation.ts:36` |
| GET | `/conversations/:id` | Get one (404 if missing) | `conversation.ts:43` |
| PATCH | `/conversations/:id` | Edit title/archived/override/profile | `conversation.ts:49` |
| DELETE | `/conversations/:id` | Delete | `conversation.ts:55` |
| POST | `/conversations/:id/reset-skills` | Re-detect skills available to this conversation | `conversation.ts:60` |
| POST | `/conversations/:id/messages` | Send a user message; agent runs in background | `conversation.ts:65` |
| GET | `/conversations/:id/messages` | List all persisted messages | `conversation.ts:81` |
| POST | `/conversations/:id/cancel` | Cancel the in-flight run | `conversation.ts:85` |
| GET | `/conversations/:id/stream` | SSE stream of agent events | `conversation.ts:90` |
| GET | `/ai-agent/catalog` | List available agents + their availability | `ai-agent.ts:36` |
| POST | `/ai-agent/run` | One-shot agent run (no conversation thread) | `ai-agent.ts:43` |

## POST `/conversations`

```ts
{
  title: string                          // required
  profileId?: string                     // pick credentials/home from this profile
  workspacePath?: string                 // cwd for the agent
  agent?: 'claude' | 'codex'             // if omitted, profile decides
  override?: Record<string, unknown>     // per-conversation config overrides
}
```

Example:

```bash
curl -s -X POST "$BASE/conversations" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Spec review","agent":"claude","workspacePath":"/path/to/repo"}'
```

`workspacePath` accepts any absolute path the agent will treat as its cwd — Windows backslash paths work too (`"C:\\Projects\\foo"` with backslashes escaped in JSON). Response: `{ ok: true, conversation }` (201).

## GET `/conversations`

Query: `?limit=<int>&archived=true|false`. Defaults: limit 50, archived undefined (returns all).

## PATCH `/conversations/:id`

```ts
{
  title?: string
  archived?: boolean
  override?: Record<string, unknown>
  profileId?: string | null              // explicit null to detach
  workspacePath?: string
}
```

## POST `/conversations/:id/messages`

```ts
{
  content: string                        // required
  override?: Record<string, unknown>     // one-shot override for this turn
}
```

Returns `202` with `{ ok: true, msgId, messageId }` — the run is dispatched. Subscribe to `/conversations/:id/stream` for events.

Error responses:

- `409` `{ ok: false, error: { code: 'no_credentials', profileId, agent } }` — selected profile has no signed-in agent. Surface to the user; they need to log in via `admin.md` → profile login/terminal.

## GET `/conversations/:id/stream` (SSE)

Server-Sent Events. Each event is `event: <name>\ndata: <json>\n\n`. To consume the stream, use `curl --no-buffer` (works on all platforms):

```bash
curl --no-buffer "$BASE/conversations/$ID/stream"
```

The connection stays open and prints events as they arrive. Ctrl-C to disconnect.

## POST `/conversations/:id/cancel`

Fires `cancel()` on the running agent. Safe even if no run is in flight.

## POST `/conversations/:id/reset-skills`

Returns `{ ok: true, skills }` — the recomputed skill index for this conversation.

## GET `/ai-agent/catalog`

No params. Returns:

```ts
{
  ok: true,
  catalog: {
    agentAvailability: {
      claude: { available: boolean, path?: string, ... },
      codex:  { available: boolean, path?: string, ... }
    },
    ...
  }
}
```

Use this before `/ai-agent/run` to confirm the chosen agent CLI is installed.

## POST `/ai-agent/run`

```ts
{
  agent: 'codex' | 'claude'              // required
  cwd: string                            // required
  prompt: string                         // required
  workspaceId?: string
  sessionId?: string
  prevAgentSessionId?: string
  profileId?: string
  model?: string
  claudeCliProfile?: string
  extraEnv?: Record<string, string>
  appendSystemPrompt?: string
  yolo?: boolean
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access'
  approvalPolicy?: 'untrusted' | 'on-request' | 'on-failure' | 'never'
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
  allowedTools?: string[]
  disallowedTools?: string[]
}
```

Example:

```bash
curl -s -X POST "$BASE/ai-agent/run" \
  -H 'Content-Type: application/json' \
  -d '{
    "agent": "claude",
    "cwd": "/path/to/anubis-workspaces",
    "prompt": "Summarize the README in three bullets.",
    "permissionMode": "plan"
  }'
```

On Windows, escape backslashes in `cwd` for valid JSON: `"C:\\Projects\\anubis-workspaces"`.

Response: passthrough of `aiAgentService.runAgent()` — agent stdout, exit code, etc.

## Workflows

### Start a conversation and send the first message

```bash
ID=$(curl -s -X POST "$BASE/conversations" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"Refactor plan\",\"agent\":\"claude\",\"workspacePath\":\"$PWD\"}" \
  | jq -r .conversation.id)

curl -s -X POST "$BASE/conversations/$ID/messages" \
  -H 'Content-Type: application/json' \
  -d '{"content":"Outline a refactor for packages/backend"}'

# Then poll /conversations/$ID/messages or open the SSE stream:
curl --no-buffer "$BASE/conversations/$ID/stream"
```

PowerShell users can swap `$PWD` for `$PWD.Path` and the rest works under `pwsh`.

### Recover from `no_credentials` on send

1. Send fails with 409 `{ error: { code: 'no_credentials', profileId, agent } }`.
2. Trigger login: `POST /profiles/$profileId/login/terminal` (see `admin.md`).
3. After the user finishes login in the spawned terminal, retry `POST /conversations/:id/messages`.
