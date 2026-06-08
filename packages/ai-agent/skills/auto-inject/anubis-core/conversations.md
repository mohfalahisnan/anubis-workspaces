# Conversations + AI agent runs

Conversations are threaded chats with one of the agent CLIs (`claude`, `codex`, `antigravity`, `gpt-web`). You are quite possibly running inside one right now. Use this file when the user wants to **start, drive, or inspect chats** — or fire a one-shot agent run that doesn't persist as a conversation.

## When to use this file

- "Start a new chat called X."
- "Send this to the conversation" (when the user is referring to a different chat, e.g. via id).
- "Stream events from chat X."
- "Cancel the agent that's running right now."
- "Re-detect skills available to this chat."
- "Switch this chat's profile / workspace."
- "Archive these old chats."
- "Just run a one-shot agent against this prompt in /tmp/foo — I don't need a thread."
- "Which agents are installed?"

## Mental model

A **conversation** has:

- `title`, `archived`, `projectId` (defaults to `default`), `source` (`manual` or `workflow`).
- `profileId` — which agent profile drives this chat. Determines the CLI + credentials + agent home.
- `agent` — `claude | codex | antigravity | gpt-web`. If omitted at creation, the profile decides.
- `workspacePath` — absolute cwd the agent treats as its working directory.
- `override` — per-conversation config that's shallow-merged onto the profile config.

When the user sends a message, the route returns `202` immediately and the agent runs in the background. Subscribe to the SSE stream to see partials, tool calls, tool results, and the final message.

If the chosen profile has never been logged in for its agent CLI, sending fails with `409 no_credentials`. The recovery is `admin.md` → `POST /profiles/:id/login/terminal`, wait for the user, then retry the send.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/conversations` | Create |
| GET | `/conversations?limit&archived&source&projectId` | List, filtered |
| GET | `/conversations/:id` | Get one (404 if missing) |
| PATCH | `/conversations/:id` | Edit title/archived/override/profile/workspace |
| DELETE | `/conversations/:id` | Delete |
| POST | `/conversations/:id/reset-skills` | Re-scan skills available to this chat |
| POST | `/conversations/:id/messages` | Send a message; agent runs in the background |
| GET | `/conversations/:id/messages` | List persisted messages |
| POST | `/conversations/:id/cancel` | Cancel the in-flight run |
| GET | `/conversations/:id/stream` | SSE event stream (replay + live) |
| GET | `/ai-agent/catalog` | Which agent CLIs are installed/available |
| POST | `/ai-agent/run` | One-shot agent run, no persistence |

All bodies `.strict()` Zod.

## POST `/conversations`

```ts
{
  title: string                                                    // required
  profileId?: string                                               // pick credentials/home
  projectId?: string                                               // omitted → 'default'
  workspacePath?: string                                           // agent cwd
  agent?: 'claude' | 'codex' | 'antigravity' | 'gpt-web'           // if omitted, profile decides
  override?: Record<string, unknown>                               // per-conversation config patch
}
```

```bash
curl -s -X POST "$BASE/conversations" \
  -H 'Content-Type: application/json' \
  -d '{
    "title":"Spec review",
    "agent":"claude",
    "projectId":"'$PID'",
    "workspacePath":"/path/to/repo"
  }'
```

`workspacePath` can be any absolute path the agent will treat as cwd. On Windows, escape backslashes in JSON (`"C:\\Projects\\foo"`). Response: `{ ok: true, conversation }` (201).

## GET `/conversations`

Query params:

```ts
{
  limit?: number                  // default 50
  archived?: 'true' | 'false'     // omit to return both
  source?: 'manual' | 'workflow'  // omit to return both
  projectId?: string              // omit to return across projects
}
```

```bash
curl -s "$BASE/conversations?projectId=$PID&archived=false&source=manual&limit=20"
```

Use `source=manual` when the user wants their own chats and not the automated ones spawned by workflow runs.

## PATCH `/conversations/:id`

```ts
{
  title?: string
  archived?: boolean
  override?: Record<string, unknown>
  profileId?: string | null                                       // explicit null detaches
  workspacePath?: string
}
```

Changing `profileId` to `null` means "use the system default" — that conversation will need a profile assigned before it can send again.

## POST `/conversations/:id/messages`

```ts
{
  content: string                                                  // required
  override?: Record<string, unknown>                               // one-shot override for this turn
}
```

Returns `202 { ok: true, msgId, messageId }`. Then either:

- Watch the SSE stream (preferred for live UX), or
- Poll `GET /conversations/:id/messages` (sufficient for batch checks).

Error responses:

- `409 { ok: false, error: { code: 'no_credentials', profileId, agent } }` — the profile's agent CLI has not been logged in. **Don't retry the send immediately.** Tell the user, then call `admin.md` → `POST /profiles/$profileId/login/terminal`. After they confirm login is done, retry the message.

## GET `/conversations/:id/stream` (SSE)

```bash
curl --no-buffer "$BASE/conversations/$ID/stream"
```

The stream replays buffered events for the current/just-finished turn before going live — so a reconnecting subscriber catches up on partials, tool calls, and tool results it missed. Each event is `event: <name>\ndata: <json>\n\n`. Ctrl-C closes the stream.

## POST `/conversations/:id/cancel`

Fires `cancel()` on the running agent for this conversation. Safe even if nothing is running. Use for "stop", "cancel", "abort".

## POST `/conversations/:id/reset-skills`

Returns `{ ok: true, skills }` — the recomputed skill index for this conversation. Use when the user has just imported a new skill (`admin.md`) and wants this chat to pick it up.

## GET `/ai-agent/catalog`

No params. Returns:

```ts
{
  ok: true,
  catalog: {
    agentAvailability: {
      claude:      { available: boolean, path?: string, ... },
      codex:       { available: boolean, path?: string, ... },
      antigravity: { available: boolean, path?: string, ... },
      'gpt-web':   { available: boolean, path?: string, ... }
    },
    ...
  }
}
```

Always check this before `/ai-agent/run` (or before suggesting an agent in `POST /conversations`) — picking an unavailable agent gets you a confusing failure later.

## POST `/ai-agent/run`

One-shot agent run. No conversation thread is created; the response is the agent's exit data.

```ts
{
  agent: 'codex' | 'claude' | 'antigravity' | 'gpt-web'           // required
  cwd: string                                                      // required, absolute
  prompt: string                                                   // required
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

```bash
curl -s -X POST "$BASE/ai-agent/run" \
  -H 'Content-Type: application/json' \
  -d '{
    "agent":"claude",
    "cwd":"/path/to/anubis-workspaces",
    "prompt":"Summarize the README in three bullets.",
    "permissionMode":"plan"
  }'
```

On Windows escape backslashes: `"C:\\Projects\\anubis-workspaces"`.

Use this for short, scripted, automated calls (e.g. inside a workflow). For interactive chats, always go through `/conversations`.

## Workflows the user actually asks for

### Start a fresh chat and send the first message

```bash
ID=$(curl -s -X POST "$BASE/conversations" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"Refactor plan\",\"agent\":\"claude\",\"projectId\":\"$PID\",\"workspacePath\":\"$PWD\"}" \
  | jq -r .conversation.id)

curl -s -X POST "$BASE/conversations/$ID/messages" \
  -H 'Content-Type: application/json' \
  -d '{"content":"Outline a refactor for packages/backend"}'

# Watch live
curl --no-buffer "$BASE/conversations/$ID/stream"
```

PowerShell users: swap `$PWD` for `$PWD.Path`.

### Recover from `no_credentials`

1. Send returns `409 { error: { code: 'no_credentials', profileId, agent } }`.
2. `admin.md` → `POST /profiles/$profileId/login/terminal` — a native terminal opens running `<agent> login`.
3. Tell the user: "I opened a terminal — finish the login flow there and tell me when you're done."
4. After they confirm, retry `POST /conversations/$ID/messages` with the same body.

### Re-route a chat to a different profile

If a chat was started with the wrong profile (e.g. user logged in on a different one):

```bash
curl -s -X PATCH "$BASE/conversations/$ID" \
  -H 'Content-Type: application/json' \
  -d '{"profileId":"'$NEW_PROFILE'"}'
```

Then send again. If the new profile also lacks credentials, you'll hit `409 no_credentials` and the recovery above.

### Find recent unfinished workflow-spawned chats

```bash
curl -s "$BASE/conversations?source=workflow&archived=false&limit=30"
```

These are the chats kicked off by workflow runs — useful when the user asks "what's that AI doing in the background?".

### Stop a runaway agent

```bash
curl -s -X POST "$BASE/conversations/$ID/cancel"
```

Safe to call even if nothing is running.
