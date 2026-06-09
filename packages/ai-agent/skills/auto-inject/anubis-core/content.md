# Projects + content items

User's own drafts. Each item references one captured post OR one URL — never both.

Lifecycle: `idea → brief → draft → review → scheduled → published → rejected`. Transitions = PATCH. Not enforced; you can jump.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/projects` | List |
| GET | `/projects/:id` | Get |
| POST | `/projects` | Create |
| PATCH | `/projects/:id` | Update |
| DELETE | `/projects/:id` | Soft-delete (403 if `default`) |
| GET | `/content-items?projectId&status&limit` | List |
| GET | `/content-items/:id` | Get |
| POST | `/content-items` | Create |
| PATCH | `/content-items/:id` | Update |
| DELETE | `/content-items/:id` | Soft-delete |
| POST | `/content-items/:id/sync-metrics` | Re-scrape `publishedUrl`, write analytics |

## POST /projects

```ts
{ name: string, emoji?, color?, description?, workdir? }
```

## POST /content-items

```ts
{
  projectId?: string                   // default 'default' / reference's project
  referencePostId?: string             // exactly one of these two
  referenceUrl?: string
  title: string                        // required
  status?: 'idea'|'brief'|'draft'|'review'|'scheduled'|'published'|'rejected'
  rawBrief?, improvedDraft?, sourceWorkflowRunId?, sourceConversationId?
}
```

Refinements:
- Exactly one of `referencePostId` / `referenceUrl`. Both or neither → 400 `path: ['referencePostId']`.
- `referencePostId` not found → `404 reference_not_found`.
- `projectId` ≠ referenced post's project → `400 reference_project_mismatch`. Omit `projectId` to inherit.

## PATCH /content-items/:id

```ts
{
  title?, status?, rawBrief?, improvedDraft?
  rejectionReason?: string|null
  publishedUrl?: string|null
  publishedAt?: string|null
  analytics?: { likes?: number|null, comments?: number|null, saves?: number|null }
  sourceWorkflowRunId?: string|null
  sourceConversationId?: string|null
}
```

`null` clears.

## POST /content-items/:id/sync-metrics

No body. Requires `publishedUrl`. Calls crawler on `public` profile, writes `likes`/`comments`/`metricsSyncedAt`.

Errors:
- `400 missing_published_url`
- `404 no_post_metrics_found` (URL didn't resolve to a post)
- `500 { code: 'SYNC_FAILED', message }` (auth = post gated)

## Examples

Draft from a captured post (let backend inherit projectId):
```bash
curl -s -X POST "$BASE/content-items" -H 'Content-Type: application/json' \
  -d '{"title":"Riff on NASA reel","referencePostId":"'$POST_ID'","status":"idea"}'
```

Mark published + sync:
```bash
curl -s -X PATCH "$BASE/content-items/$CID" -H 'Content-Type: application/json' \
  -d '{"status":"published","publishedUrl":"https://instagram.com/p/abcd","publishedAt":"2026-06-09T00:00:00Z"}'
curl -s -X POST "$BASE/content-items/$CID/sync-metrics"
```
