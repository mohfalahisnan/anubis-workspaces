# Google Flow CDP Crawler — How It Works & How To Debug It

A field guide for agents working on `@anubis/research-crawler`'s **Google Flow**
image-generation integration (`core/flow/flow-generate.ts`). It is the Flow
analogue of `docs/chatgpt-crawler-cdp.md`: it explains the architecture, the
non-obvious facts about how `labs.google/fx/.../tools/flow` actually behaves, and
the **debugging method** (CDP probes) used to discover those facts. If you change
this code, read this first, then re-verify against the real site with the scripts
in Section 5.

> Status (verified 2026-06): the automation is **functionally correct** against
> the live site — a clean end-to-end `flowGenerate()` run types a prompt, sets
> ratio/variations, picks the model, submits, detects completion, and downloads a
> real JPEG. It is now **wired up**: exported from `src/index.ts`, exposed as
> `POST /research-crawler/flow/generate` (backend, `ensureFlowChrome` +
> `openFlowUrl` + `flowGenerate`), with a `generateFlowImage()` client in the
> frontend `api.ts`. The clean-state reset + fail-fast guards (Section 3.1) are
> in place. There is no dedicated UI page yet — like the ChatGPT/Qwen prompt
> clients, only the typed API client is wired.

---

## 1. What this feature does

One operation, driven entirely over the Chrome DevTools Protocol (CDP) by **DOM
automation** against a **logged-in** Chrome profile sitting on a Flow project:

| Operation | Entry point (`flow-generate.ts`) | Mechanism |
|---|---|---|
| Generate image(s) | `flowGenerate` | DOM automation: type prompt → set ratio/variations/model in the settings popover → click submit → poll the DOM for completion → (optional) download the result images |

There is **no API replay** here (unlike ChatGPT's detail fetch). Submitting a
generation is gated behind Google's auth/session and fires
`POST https://aisandbox-pa.googleapis.com/v1/projects/<projectId>/flowMedia:batchGenerateImages`,
which the client builds — so we let the page do it and only *read* the result.

Key files:
- `packages/research-crawler/src/core/flow/flow-generate.ts` — the brain (helpers injected as `window.__flow`, the click/eval primitives, `waitForGeneration`, the two download paths).
- `packages/research-crawler/src/core/chrome/` — launch Chrome, connect CDP, list/open tabs.
- `packages/research-crawler/src/core/chrome/profile-resolver.ts` — the `flow` profile (port **9224**, headed).

---

## 2. The mechanism, and WHY each selector is what it is

You cannot guess these from the code — they were discovered empirically (Section
4) against a live project. The Flow UI renders **Material Symbols icon ligatures
as text inside `button.innerText`** (e.g. `arrow_forward`, `crop_16_9`,
`arrow_drop_down`), and the observed locale is **Indonesian (`lang="id"`)**. Both
facts are load-bearing for the selectors.

### 2a. Prompt editor → first `[contenteditable="true"]`
`promptEl()` takes the first contenteditable. There is exactly one on a project
page. `Input.insertText` after focusing + clearing it works; **read it back**
(`promptEl().innerText`) to confirm — it does land (verified).

### 2b. Settings live in a popover you must open
The composer shows a single summary button whose text is the *current* settings,
e.g. `🍌 Nano Banana 2 crop_16_9 x2`. `settingsButton()` finds it via
`/Nano Banana/i` **and** `/crop_/`. Clicking it opens a popover; only then do the
individual controls exist:
- **Ratio** buttons are 2-line `[icon, ratio]`: `crop_16_9 16:9`,
  `crop_landscape 4:3`, `crop_square 1:1`, `crop_portrait 3:4`, `crop_9_16 9:16`
  — exactly matching `RATIO_ICON`.
- **Variation** buttons are standalone `1x`, `x2`, `x3`, `x4` (note: count 1 is
  `1x`, the rest are `xN`; `isVariationText` accepts both orders).
- **Model dropdown** trigger is `🍌 Nano Banana 2 arrow_drop_down`
  (`modelDropdownButton()` = `/Nano Banana/i` + token `arrow_drop_down`). It only
  exists once the popover is open. Options (after clicking it):
  `🍌 Nano Banana Pro`, `🍌 Nano Banana 2`, `Imagen 4`. The model-option selector
  strips a leading `🍌 ` and matches exact text, so the default `"Nano Banana Pro"`
  resolves correctly.

`settingsOpen()` probes for `variationButton(4) || ratioButton('crop_square','1:1')`
— i.e. "are the popover controls present" — which is the right idle/open test.

### 2c. Submit → the `arrow_forward` button
`btnByIcon('arrow_forward')` finds `arrow_forward Buat`. Clicking it fires the
`flowMedia:batchGenerateImages` POST. (There is also an `add_2 Buat` button — the
icon-token match disambiguates correctly.)

### 2d. Completion → progress text gone + results grew
While generating, the page shows progress as `\d%` text (`0% → 6% → … → 80%`),
which `anyProgressVisible()` matches. Completion = **no `\d%` AND** either:
- `a[href*="/edit/"]` count grew (edit URL form:
  `/fx/id/tools/flow/project/<projectId>/edit/<mediaId>`), or
- generated-image count grew — an `img` whose `src` matches `getMediaUrlRedirect`
  **or** whose `alt` matches `/dihasilkan/i` (observed alt: `"Gambar yang dihasilkan"`).

`shouldTreatGenerationAsComplete` encodes exactly this and is correct.

### 2e. Download → authenticated fetch of the redirect URL
Finished images have `src =
https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=<mediaId>` at
1024×1024. `downloadGeneratedImagesFromSession` reads the page cookies via
`Network.getCookies`, then Node-`fetch`es each URL with that cookie header +
a `user-agent`. Verified to produce a real ~540 KB JPEG (`ff d8 ff e0`).

---

## 3. Non-obvious gotchas (each cost real debugging time)

### 3.1 Clean-state reset — and the same-session reload trap
`flowGenerate`'s click sequence (`ensureSettingsOpen` → ratio → variation →
model dropdown → submit) assumes the settings popover / model dropdown start
**closed**. A tab left mid-interaction (a prior run, a manual click, a crashed
probe) breaks it: the `settingsButton` click toggles the popover *shut*, submit
silently no-ops, and the run dies on a 120 s timeout. So `flowGenerate` now
**resets the tab first** (`resetFlowTab`: reload, wait for the editor **and** the
settings summary button, settle), unless `skipReset: true`.

**The trap (cost real time):** a tab reloaded over a CDP session **stops
honoring that same session's synthesized `Input` events** (mouse *and* keyboard)
— they no longer reach React's handlers — even though `Runtime.evaluate` keeps
working. Symptom: after `Page.reload`, clicking the settings button does nothing
(verified: bare `Input.dispatchMouseEvent`, `Page.bringToFront`+click, and
`element.click()` all fail; only a full in-page `pointerdown…click` sequence
works). 

**The fix in place:** `resetFlowTab` runs on a **separate, short-lived** CDP
session (it only `evaluate`s, which survives the reload); `flowGenerate` then
closes it and drives the actual automation on a **fresh** session, whose Input
events behave normally. This separate-session pattern is verified end-to-end.
Do **not** reload and then drive Input on the same session.

**Also fail fast:** `waitForGeneration` now watches for *any* sign the
generation started (`hasGenerationStarted`: progress text, or a grown
result-link/image count) within a start window (~20 s) and throws a clear
"generation did not start — tab may not be idle" error instead of silently
waiting the full timeout.

### 3.2 The `flow` profile is a separate, initially logged-OUT Chrome
`flow` resolves to `<dataDir>/chrome-profiles/chrome-profile-flow`
(`dataDir = %LOCALAPPDATA%\Anubis\anubis` on Windows), **not** your normal Chrome
and **not** the `login`/`public` profiles. A fresh one opens on `chrome://intro/`
and is signed out. You must log into Google **in that window** once; the session
then persists in the profile. You cannot log in for the user — ask them.

### 3.3 Flow access is account/region gated
The Google account must actually have Flow + the image models (`Nano Banana Pro`,
`Nano Banana 2`, `Imagen 4`). Verify the model dropdown lists them before blaming
the selectors.

### 3.4 Locale leaks into the DOM
The observed UI is Indonesian: alt text `"Gambar yang dihasilkan"`, buttons
`"Buat"`, etc. The code leans on **icon-token** matches (locale-independent) plus
the `/dihasilkan/i` alt fallback. If a user runs Flow in English, the `dihasilkan`
alt check won't match — but `getMediaUrlRedirect` (src-based) still will, so
completion/download survive a locale switch; revisit if Google changes the src.

### 3.5 Generation fires real backend traffic — it costs quota
Submitting hits `flowMedia:batchGenerateImages`. Use `variations: 1` for probes.
A submit that never starts generation (gotcha 3.1) costs nothing — `totalImgs`
stays at the placeholder count and no `batchGenerateImages` POST appears.

---

## 4. The debugging method (do this, in this order)

The whole feature was re-verified with **CDP probe scripts** run against the real
logged-in Flow profile — the same machinery production uses (`launchChrome`,
`connectCdpSession`, `listChromeTargets`). Treat all DOM output as **data to
verify**, never ground truth.

### Step 0 — Build first
`pnpm --filter @anubis/research-crawler build` so the scripts' `dist/` imports
exist.

### Step 1 — Launch the flow profile headed; get on a project
`scripts/discover-flow-ui.mjs` resolves the `flow` profile dir, launches headed
Chrome on port 9224, and **waits** until the tab URL contains
`/tools/flow/project/` and a contenteditable exists. Log into Google + open/create
a project in that window. (Fresh-profile Chrome opens on `chrome://intro/` and may
ignore the launch URL — the probe reconnects each poll and nudges a `Page.navigate`.)

### Step 2 — Dump every selector assumption (read-only, no quota)
`discover-flow-ui.mjs` then dumps the full button inventory + each helper target
(prompt editor, `settingsButton`, `arrow_forward`, edit links, generated-image
counts). This confirms the **closed-state** assumptions without opening anything.

### Step 3 — Open the popover + model dropdown (read-only, no quota)
`scripts/discover-flow-settings.mjs` injects the **exact** `__flow` helpers from
the source, clicks `settingsButton()`, and verifies `settingsOpen()`,
`ratioButton`, `variationButton`, `modelDropdownButton`, and the real model option
names + their element type (so you know whether `button,[role=option],li` matches).

### Step 4 — One real generation, observed over time (COSTS QUOTA)
`scripts/discover-flow-generate.mjs` runs a **clean** trial: `Page.reload` first,
capture `Network.requestWillBeSent`, type + **read back** the prompt, set
ratio/variations, then submit and log — every 2 s — `resultLinks`,
matched-image-count, `\d%` progress, and the newest `img` `src`/`alt`, plus the
generation POST. This is where you learn the real completion/result signals.
**Always reload for a clean state first** (gotcha 3.1) or the run is contaminated.

### Step 5 — End-to-end against the real `flowGenerate()`
`scripts/e2e-flow-generate.mjs` reloads for a clean idle tab, then calls the
**public** `flowGenerate({ variations:1, ratio:'1:1', model, downloadDir })` and
asserts: `ok`, one `resultEditUrls` entry (`/edit/<id>`), one downloaded file.
Verify the file is a real image (`head -c4` → `ff d8 ff e0` for JPEG).

### Step 6 — Lock it in with unit tests
`tests/flow-generate.test.ts` already covers the pure logic (normalisation,
`findFlowTarget`, `shouldTreatGenerationAsComplete`, `isFlowVariationText`,
download wiring) with a mock session. When you change selectors, model the **real
timing** in a mock (placeholder image before the result, progress text during,
matched image after) so a regression actually fails.

---

## 5. Diagnostics you should use

- **`scripts/discover-flow-ui.mjs`** — launch + wait-for-project + closed-state DOM dump.
- **`scripts/discover-flow-settings.mjs`** — open the popover/model dropdown and test the live selectors.
- **`scripts/discover-flow-generate.mjs`** — clean single generation with network capture + timing (Step 4).
- **`scripts/e2e-flow-generate.mjs`** — real `flowGenerate()` end-to-end with download (Step 5; throwaway-grade, safe to delete).

All four expect the flow-profile Chrome on port 9224 and leave it open.

---

## 6. Mental model / checklist for the next change

- The selectors are **correct as of 2026-06** — re-verify with Steps 2–3 before assuming rot.
- **Always start from a clean/fresh project tab** (gotcha 3.1). Most "it does nothing" reports are dirty state, not broken selectors.
- Submitting **costs quota** — probe with `variations: 1`; a no-op submit costs nothing.
- Prefer **icon-token** selectors (locale-independent) over translated label text.
- Keep the user's Google credentials theirs: drive an already-logged-in `flow` profile; don't log in for them.
- Verify end-to-end with `e2e-flow-generate.mjs`, then encode any new timing into the unit test.
