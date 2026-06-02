import { silentReporter } from "../progress/progress-reporter.js";
import { createCdpDiscoveryBrowserFactory } from "./instagram-cdp-discovery-browser.js";
import { normalizeInstagramDiscoveryInput } from "./instagram-discovery-input.js";
import {
  addDiscoveryItem,
  createInstagramDiscoveryAccumulator,
  getPostOnlyRecords,
  isDeadlineReached,
  resolveCollectedPostsUntilTarget
} from "./instagram-discovery-state.js";
import type {
  InstagramCompetitorCandidate,
  InstagramCompetitorDiscoveryBrowser,
  InstagramCompetitorDiscoveryService,
  InstagramCompetitorDiscoveryServiceOptions,
  InstagramCompetitorDiscoverySuccess
} from "./instagram-discovery-types.js";

export type {
  InstagramCompetitorCandidate,
  InstagramCompetitorDiscoveryBrowser,
  InstagramCompetitorDiscoveryFailure,
  InstagramCompetitorDiscoveryInput,
  InstagramCompetitorDiscoveryResult,
  InstagramCompetitorDiscoveryService,
  InstagramCompetitorDiscoveryServiceOptions,
  InstagramCompetitorDiscoverySource,
  InstagramCompetitorDiscoverySuccess,
  InstagramDiscoveryPostRecord,
  InstagramDiscoveryRawItem,
  InstagramPostOnlyRecord
} from "./instagram-discovery-types.js";

export function createInstagramCompetitorDiscoveryService(
  options: InstagramCompetitorDiscoveryServiceOptions = {}
): InstagramCompetitorDiscoveryService {
  return {
    async discover(input) {
      const startedAt = new Date().toISOString();
      let browser: InstagramCompetitorDiscoveryBrowser | null = null;
      const reporter = input.reporter ?? silentReporter();
      const phase = input.phaseLabel ?? "discover";
      const seenEmitted = new Set<string>();
      const emitNewCandidates = () => {
        if (!input.onCandidate) return;
        for (const [username, candidate] of (accumulator?.candidates ?? new Map<string, InstagramCompetitorCandidate>())) {
          if (seenEmitted.has(username)) continue;
          seenEmitted.add(username);
          input.onCandidate(candidate);
        }
      };
      let accumulator: ReturnType<typeof createInstagramDiscoveryAccumulator> | null = null;

      try {
        const normalized = normalizeInstagramDiscoveryInput(input);
        reporter.start(phase, normalized.targetCompetitors);
        browser = await (options.createBrowser ?? createCdpDiscoveryBrowserFactory(options))(normalized);
        await browser.openSourcePage(normalized.sourceUrl);

        accumulator = createInstagramDiscoveryAccumulator();
        let stopReason: InstagramCompetitorDiscoverySuccess["meta"]["stopReason"] = "no_more_items";
        const deadline = normalized.timeoutMs === null ? null : Date.now() + normalized.timeoutMs;

        if (browser.collectModalProfiles) {
          const items = await browser.collectModalProfiles({
            targetItems: normalized.targetCompetitors,
            deadlineMs: deadline
          });
          for (const item of items) {
            addDiscoveryItem(accumulator, item);
            reporter.update(phase, accumulator.candidates.size, "candidates");
            emitNewCandidates();
          }
          stopReason = accumulator.candidates.size >= normalized.targetCompetitors
            ? "target_reached"
            : isDeadlineReached(deadline)
              ? "timeout"
              : "no_more_items";
        }

        while (!browser.collectModalProfiles && accumulator.candidates.size < normalized.targetCompetitors && !isDeadlineReached(deadline)) {
          const items = await browser.scanVisibleItems();
          for (const item of items) {
            addDiscoveryItem(accumulator, item);
          }
          reporter.update(phase, accumulator.candidates.size, "candidates");
          emitNewCandidates();

          await resolveCollectedPostsUntilTarget({
            browser,
            accumulator,
            targetCompetitors: normalized.targetCompetitors
          });
          reporter.update(phase, accumulator.candidates.size, "candidates");
          emitNewCandidates();

          if (accumulator.candidates.size >= normalized.targetCompetitors) {
            stopReason = "target_reached";
            break;
          }
          if (isDeadlineReached(deadline)) {
            stopReason = "timeout";
            break;
          }

          const moved = await browser.scroll();
          if (!moved) {
            stopReason = "no_more_items";
            break;
          }
        }

        const postList = [...accumulator.posts.values()];
        const candidateList = [...accumulator.candidates.values()];
        const postOnly = getPostOnlyRecords({
          accumulator,
          browserSupportsModalCollection: Boolean(browser.collectModalProfiles)
        });
        const finishedAt = new Date().toISOString();
        reporter.done(phase);
        const status = candidateList.length >= normalized.targetCompetitors ? "success" : "partial";
        return {
          ok: true,
          status,
          candidates: candidateList,
          posts: postList,
          postOnly,
          rawItems: accumulator.rawItems,
          meta: {
            source: normalized.source,
            ...(normalized.hashtag ? { hashtag: normalized.hashtag } : {}),
            ...(normalized.keyword ? { keyword: normalized.keyword } : {}),
            targetCompetitors: normalized.targetCompetitors,
            rawItemCount: accumulator.rawItems.length,
            postCount: postList.length,
            candidateCount: candidateList.length,
            postOnlyCount: postOnly.length,
            startedAt,
            finishedAt,
            stopReason,
            sourceUrl: normalized.sourceUrl
          }
        };
      } catch (error) {
        const invalidInput = isInvalidDiscoveryInputError(error);
        return {
          ok: false,
          error: {
            code: invalidInput ? "INSTAGRAM_DISCOVERY_INVALID_INPUT" : "INSTAGRAM_DISCOVERY_FAILED",
            message: error instanceof Error ? error.message : invalidInput
              ? "Instagram discovery input is invalid."
              : "Instagram competitor discovery failed."
          }
        };
      } finally {
        await browser?.close();
      }
    }
  };
}

function isInvalidDiscoveryInputError(error: unknown): boolean {
  return error instanceof Error && (
    error.message === "Choose Explore, Hashtag, or Keyword." ||
    error.message === "Hashtag is required." ||
    error.message === "Hashtag contains unsupported characters." ||
    error.message === "Keyword is required." ||
    error.message === "Target candidates must be a positive number." ||
    error.message === "Chrome debugging origin must start with http or https."
  );
}
