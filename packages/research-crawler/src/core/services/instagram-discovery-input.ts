import { normalizeChromeOrigin } from "../chrome/chrome-connector.js";
import type {
  InstagramCompetitorDiscoveryInput,
  NormalizedInstagramCompetitorDiscoveryInput
} from "./instagram-discovery-types.js";

export function normalizeInstagramDiscoveryInput(
  input: InstagramCompetitorDiscoveryInput
): NormalizedInstagramCompetitorDiscoveryInput {
  const source = input.source === "hashtag" ? "hashtag" : input.source === "explore" ? "explore" : input.source === "keyword" ? "keyword" : null;
  if (!source) throw new Error("Choose Explore, Hashtag, or Keyword.");

  const hashtag = typeof input.hashtag === "string" ? input.hashtag.trim().replace(/^#/, "") : "";
  if (source === "hashtag" && !hashtag) throw new Error("Hashtag is required.");
  if (hashtag && !/^[A-Za-z0-9._]+$/.test(hashtag)) throw new Error("Hashtag contains unsupported characters.");

  const keyword = typeof input.keyword === "string" ? input.keyword.trim() : "";
  if (source === "keyword" && !keyword) throw new Error("Keyword is required.");

  const targetCompetitors = normalizePositiveInteger(input.targetCompetitors, "Target candidates");

  const chromeOrigin = normalizeChromeOrigin(typeof input.chromeOrigin === "string" ? input.chromeOrigin : undefined);
  const timeoutMs = typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs)
    ? Math.max(1000, Math.floor(input.timeoutMs))
    : null;

  return {
    source,
    ...(hashtag ? { hashtag } : {}),
    ...(keyword ? { keyword } : {}),
    targetCompetitors,
    chromeOrigin,
    timeoutMs,
    sourceUrl: source === "hashtag"
      ? `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(`#${hashtag}`)}`
      : source === "keyword"
        ? `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(keyword)}`
        : "https://www.instagram.com/explore/"
  };
}

function normalizePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return Math.floor(value);
}
