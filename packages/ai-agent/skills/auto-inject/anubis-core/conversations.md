# Conversations + AI agent

Threaded chats backed by a CLI (`claude|codex|antigravity|gpt-web|qwen-web`). Or one-shot `/ai-agent/run` (no thread).

Message send returns `202` and runs the agent in the background. Subscribe to SSE for events.

Profile config layers (low → high): `profile.config → conversation.override → message.override`.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/conversations` | Create |
| GET | `/conversations?limit&archived&source&projectId` | List |
| GET | `/conversations/:id` | Get |
| PATCH | `/conversations/:id` | Update |
| DELETE | `/conversations/:id` | Delete |
| POST | `/conversations/:id/reset-skills` | Re-scan skills |
| POST | `/conversations/:id/messages` | Send message (202) |
| GET | `/conversations/:id/messages` | List messages |
| POST | `/conversations/:id/cancel` | Cancel run |
| GET | `/conversations/:id/stream` | SSE event stream |
| GET | `/ai-agent/catalog` | Which CLIs are installed |
| POST | `/ai-agent/run` | One-shot, no thread |

## POST /conversations

```ts
{
  title: string                        // required
  profileId?, projectId?, workspacePath?
  agent?: 'claude'|'codex'|'antigravity'|'gpt-web'|'qwen-web'  // omit → profile decides
  override?: Record<string, unknown>
}
```

Windows paths: escape backslashes (`"C:\\Projects\\foo"`).

## GET /conversations query

```
?limit=50&archived=true|false&source=manual|workflow&projectId=<id>
```

## PATCH /conversations/:id

```ts
{
  title?, archived?: boolean, override?
  profileId?: string|null              // null detaches
  workspacePath?: string
}
```

## POST /conversations/:id/messages

```ts
{ content: string, override?: Record<string, unknown> }
```

Returns `202 { ok: true, msgId, messageId }`.

Errors:
- `409 { error: { code: 'no_credentials', profileId, agent } }` — profile not logged in. Run `admin.md` → `POST /profiles/$profileId/login/terminal`, wait, retry the send.

## GET /conversations/:id/stream

```bash
curl --no-buffer "$BASE/conversations/$ID/stream"
```

Replays buffered events for current/just-finished turn, then live. Each event: `event: <name>\ndata: <json>\n\n`.

## GET /ai-agent/catalog

```ts
{ ok: true, catalog: { agentAvailability: { claude: {available, path?}, codex: {...}, antigravity: {...}, 'gpt-web': {...}, 'qwen-web': {...} } } }
```

Check before `/ai-agent/run` or picking `agent` on create.

## POST /ai-agent/run

```ts
{
  agent: 'claude'|'codex'|'antigravity'|'gpt-web'|'qwen-web'  // required
  cwd: string                          // required, absolute
  prompt: string                       // required
  workspaceId?, sessionId?, prevAgentSessionId?
  profileId?, model?, claudeCliProfile?
  extraEnv?: Record<string, string>
  appendSystemPrompt?, yolo?: boolean
  reasoningEffort?: 'minimal'|'low'|'medium'|'high'
  sandboxMode?: 'read-only'|'workspace-write'|'danger-full-access'
  approvalPolicy?: 'untrusted'|'on-request'|'on-failure'|'never'
  permissionMode?: 'default'|'acceptEdits'|'plan'|'bypassPermissions'
  allowedTools?: string[]
  disallowedTools?: string[]
}
```

For interactive chats use `/conversations`. Use this for scripts/workflows.

## Example

```bash
ID=$(curl -s -X POST "$BASE/conversations" -H 'Content-Type: application/json' \
  -d "{\"title\":\"Refactor\",\"agent\":\"claude\",\"projectId\":\"$PID\",\"workspacePath\":\"$PWD\"}" \
  | jq -r .conversation.id)

curl -s -X POST "$BASE/conversations/$ID/messages" -H 'Content-Type: application/json' \
  -d '{"content":"Outline a refactor"}'

curl --no-buffer "$BASE/conversations/$ID/stream"
```

Recover `no_credentials`: see `admin.md` login flow. Reroute profile: `PATCH /conversations/:id { "profileId": "..." }`.
