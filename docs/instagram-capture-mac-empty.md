# Instagram capture returns empty on macOS (works on Windows)

Status: **diagnosis + fix plan** (root cause not yet confirmed on a Mac at time of writing)

## Symptom

Running an Instagram capture through `@anubis/research-crawler`:

- **Windows:** works correctly — posts/profile data come back.
- **macOS:** Chrome opens, the page loads, but the capture result is **empty**
  (no posts/profile), returned as a *successful* response — not a thrown error.

Reproduced with the **`login`** profile (headed Chrome, already logged in to
Instagram), so this is **not** an authentication / login-wall problem.

## How capture works (the path under investigation)

1. `captureInstagramData` launches/reuses Chrome on the resolved profile port and
   attaches over CDP — `packages/research-crawler/src/core/instagram-crawler.ts`.
2. `createInstagramCdpCaptureService().capture()` resolves a target tab and runs
   the network listener — `packages/research-crawler/src/core/services/instagram-cdp-capture.service.ts`.
3. `resolveInstagramTarget` picks the tab to drive — `packages/research-crawler/src/core/chrome/chrome-connector.ts`.
4. `captureInstagramNetworkResponses` listens for Instagram JSON XHRs
   (`/graphql/query`, `/api/v1/…`), scrolls, and reads response bodies —
   `packages/research-crawler/src/core/network/network-listener.ts`.
5. If **zero** matching responses arrive within the no-data grace window (~9s),
   it bails and returns empty.

"Empty capture" means **step 4 matched zero responses.**

## Investigation findings

- The entire capture + CDP path is **platform-identical** — there is no
  `process.platform` branch in the connection, target resolution, response
  filter, or WebSocket layer.
- The CDP origin is hard-pinned to `127.0.0.1`, so this is **not** an
  IPv4/IPv6 (`localhost` → `::1`) issue.
- Because the result is a *silent empty* (not a thrown error), CDP connected and
  the page navigated successfully. The failure is specifically: **the listener
  observed no Instagram JSON responses it recognized.**

### Blocker: the Instagram listener is a black box on failure

In `network-listener.ts`, the **ChatGPT** listener records every observed
response and logs `MATCH`/`skip`, `body ok`/`body EMPTY`, plus a final summary.
The **Instagram** listener logs only a single "no-data bail" line, and the
capture service never passes a `debug` collector at all.

As a result, even running with `ANUBIS_DEBUG_CDP=1` cannot currently
distinguish the three different root causes:

| Evidence on the Mac | Root cause it points to |
| --- | --- |
| Responses **observed but not matched** | Instagram changed its endpoint shape, or capture is driving a page that doesn't re-fire the XHRs |
| Responses **matched but body empty** | `Network.getResponseBody` race / body already evicted |
| **No responses at all** | Wrong/stale tab is being driven, or the page never re-fetched |

This must be fixed first so the next Mac run is self-diagnosing.

## Leading hypothesis

**Capture attaches to and drives the wrong tab on macOS.**

Default capture uses `openNewTab: false`, so it attaches to whatever
`resolveInstagramTarget` returns — and that function prefers **any existing
`instagram.com` tab** (`chrome-connector.ts`). On a Mac headed `login` Chrome
that **restored previous Instagram session tabs**, capture grabs an
already-loaded feed tab, then navigates/scrolls a page that may not re-fire the
GraphQL XHRs the listener waits for → empty. On Windows the `login` Chrome
typically opens clean (`about:blank`), so capture drives a fresh tab and the
XHRs fire normally.

This fits the exact symptom (headed, logged-in, empty on Mac / fine on Windows)
better than any other candidate.

## Fix plan

### Step 1 — Add diagnostics (no behavior change)

Mirror the ChatGPT listener's instrumentation in the Instagram path so failures
are observable:

- In `captureInstagramNetworkResponses`, record every observed `instagram.com`
  response (url, status, content-type, matched, body ok/empty) into the
  `CdpDebugCollector`, and emit `cdpDebug` lines like the ChatGPT path.
- Pass a `debug` collector through `createInstagramCdpCaptureService().capture()`.
- Surface counts in the result `meta` (e.g. `observedResponses`,
  `matchedResponses`, `parsedResponses`) so the empty result explains itself
  even without `ANUBIS_DEBUG_CDP`.

Then, on a Mac, reproduce once with:

```sh
ANUBIS_DEBUG_CDP=1 /Applications/Anubis.app/Contents/MacOS/Anubis
```

Read the `[cdp]` lines / `meta` counts and use the table above to localize the
failing layer.

### Step 2 — Apply the targeted fix once evidence confirms the layer

- **If "no responses / wrong tab"** (expected): make Instagram capture open a
  **fresh dedicated tab** (`openNewTab: true`) instead of attaching to a stale
  restored tab. Harmless if the hypothesis is wrong; fixes it if right.
- **If "observed but not matched":** update the response filter
  (`response-filter.ts`) / endpoint markers.
- **If "matched but empty body":** read the body on `Network.responseReceived`
  (or retry) rather than only on `loadingFinished`, to avoid eviction races.

### Step 3 — Make empty captures actionable

`detectInstagramLogin` already exists
(`packages/research-crawler/src/core/instagram/login-detector.ts`) but is not
wired into the capture path. Wire it in so an empty capture reports *why*
(not authenticated / login wall / no data) instead of a silent empty result.

## Related platform notes

- Stale-Chrome cleanup is a **no-op on macOS** — `enumerateProcesses()` returns
  `[]` on non-`win32` (`apps/desktop/electron/main/process-cleanup.ts`). A
  leftover crawler Chrome can squat the debugging port across runs. Check with
  `lsof -ti tcp:9222` (login) / `9223` (public) / `9224` (flow).
- macOS data dir: `app.getPath('userData')` →
  `~/Library/Application Support/Anubis/anubis`, so the login profile lives at
  `~/Library/Application Support/Anubis/anubis/chrome-profiles/chrome-profile-login/`.
