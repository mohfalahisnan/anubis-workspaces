# Handoff: JSON Transformer and Media Array Workflow

Date: 2026-06-05

## Current State

- Repo: `C:\Projects\anubis-workspaces`
- Branch: `codex/json-transformer-media-arrays`
- PR: https://github.com/mohfalahisnan/anubis-workspaces/pull/10
- PR status when created: draft
- Latest pushed head after P2 fix: `6fd5073`
- Local worktree status at handoff: clean

Note: a final `gh pr view 10` check timed out with a GitHub 504, but the branch was force-pushed successfully after the P2 fix.

## What Changed

Added a workflow node:

- `jsonTransformer`
- Runtime executor: `packages/workflow-runtime/src/executors/json-transformer.ts`
- Frontend node card: `packages/frontend/src/components/workflow-editor/executable-nodes/json-transformer.tsx`
- Inspector form: `packages/frontend/src/components/workflow-editor/inspector/config/json-transformer-config.tsx`
- Registered in runtime executor registry, frontend node types, palette, and inspector panel.

The JSON Transformer supports:

- JSON templates
- `{{path}}` token substitution
- Whole-token preservation of non-string values
- `$map` array transforms
- Automatic unwrapping of `{ kind: "json", value: ... }` upstream envelopes

Example template:

```json
{
  "$map": "input.rows",
  "template": {
    "label": "example",
    "value": "{{item.value}}"
  }
}
```

Extended Image / Video:

- New `source: "upstream"` mode.
- Accepts upstream arrays of URLs, local file paths, file objects, files bundles, and JSON Transformer envelopes.
- Emits `{ kind: "files", files: [...] }` when multiple upstream media items are processed.
- UI/config supports selecting `Upstream array`.

Fixed P2 review issue:

- `mediaDisplay` now accepts `kind: "files"` and picks the first contained file.
- `ocrExtractor` now accepts `kind: "files"` and picks the first contained file.
- Both also unwrap JSON envelopes recursively.

Updated Table:

- Table now unwraps JSON Transformer array output into table rows.

Updated seed script:

- `scripts/create-test-workflow.mjs` now seeds:
  - `Test: Echo static data`
  - `Test: Chain - Source -> Sink`
  - `Test: Instagram JSON media fanout`
- The fanout workflow shape is:
  - `Instagram Post -> JSON Transformer -> Image / Video`
  - `JSON Transformer -> Table`
- It uses a seeded captured Instagram post with an inline PNG, so no Instagram login is required.

## Validation Already Run

Before PR creation:

```sh
pnpm --filter @anubis/workflow-runtime test
pnpm --filter @anubis/workflow-runtime typecheck
pnpm --filter @anubis/frontend typecheck
pnpm --filter @anubis/workflow-runtime build
```

After fixing P2:

```sh
pnpm --filter @anubis/workflow-runtime test -- --run tests/executors/output-display.test.ts tests/executors/ocr-extractor.test.ts tests/executors/image-video.test.ts
pnpm --filter @anubis/workflow-runtime typecheck
pnpm --filter @anubis/workflow-runtime test
```

Final runtime result after P2:

- 14 test files passed
- 72 tests passed

Seeded workflow was also run through a backend previously and all nodes succeeded:

- `instagram-post`
- `extract-json`
- `image-video`
- `table-json`
- `table`

## Seed Data Notes

The user reported the seeded workflows were not visible in the Electron app. Root cause: earlier seeding targeted a temp/backend DB, while the visible Electron app was using:

```text
C:\Users\User\AppData\Roaming\Electron\anubis\anubis.db
```

This correct DB was seeded successfully. It now contains:

- `Test: Instagram JSON media fanout`
- `Test: Chain - Source -> Sink`
- `Test: Echo static data`
- existing `IG Post`

Final seeded IDs in the visible Electron DB:

- `Test: Instagram JSON media fanout`: `bf3a8d46-878b-421f-b8e9-bf4845608fbc`
- `Test: Chain - Source -> Sink`: `da69f888-1c34-4776-9343-b5655e2fdf26`
- `Test: Echo static data`: `6ecb37d7-5aad-4658-8747-9e23c07400ff`

If the Electron Workflows page is already open, it may not refresh automatically. Switch to another sidebar page and back to Workflows, or press `Ctrl+R`.

To reseed the visible Electron app DB:

```powershell
$env:ANUBIS_DATA_DIR='C:\Users\User\AppData\Roaming\Electron\anubis'
node scripts\create-test-workflow.mjs
```

## Review Notes

The previous review found two issues:

1. P2: `kind: "files"` output from Image / Video was not consumable by Media Display or OCR.
   - Fixed and pushed.
2. P3: Seed workflow only uses one media item, so it does not truly exercise multi-item fanout.
   - Not fixed yet. This is lower priority and remains a possible follow-up.

## Suggested Next Steps

1. Reopen/refresh the Electron Workflows page and confirm the three `Test:` workflows appear.
2. Open `Test: Instagram JSON media fanout` and run it.
3. If continuing PR work, consider addressing the P3 seed coverage by making the seeded captured post expose multiple media URLs through the same path the existing Instagram executor reads.
4. If ready, mark PR #10 ready for review.
