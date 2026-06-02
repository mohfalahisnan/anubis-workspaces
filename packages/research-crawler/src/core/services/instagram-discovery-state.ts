import { collectInstagramRecordsFromResponses, type InstagramRawJsonResponse } from "../instagram/instagram-json-scanner.js";
import type {
  InstagramCompetitorCandidate,
  InstagramCompetitorDiscoveryBrowser,
  InstagramDiscoveryPostRecord,
  InstagramDiscoveryRawItem,
  InstagramPostOnlyRecord
} from "./instagram-discovery-types.js";

export type InstagramDiscoveryAccumulator = {
  rawItems: InstagramDiscoveryRawItem[];
  rawItemKeys: Set<string>;
  posts: Map<string, InstagramDiscoveryPostRecord>;
  candidates: Map<string, InstagramCompetitorCandidate>;
  postOnlyByUrl: Map<string, InstagramPostOnlyRecord>;
  resolvedPosts: Set<string>;
};

export function createInstagramDiscoveryAccumulator(): InstagramDiscoveryAccumulator {
  return {
    rawItems: [],
    rawItemKeys: new Set<string>(),
    posts: new Map<string, InstagramDiscoveryPostRecord>(),
    candidates: new Map<string, InstagramCompetitorCandidate>(),
    postOnlyByUrl: new Map<string, InstagramPostOnlyRecord>(),
    resolvedPosts: new Set<string>()
  };
}

export function addDiscoveryItem(
  accumulator: InstagramDiscoveryAccumulator,
  item: InstagramDiscoveryRawItem
): boolean {
  const postUrl = normalizePostUrl(item.postUrl ?? item.sourcePostUrl);
  if (!postUrl) return false;

  const key = getDiscoveryItemKey(item);
  if (!key || accumulator.rawItemKeys.has(key)) return false;
  accumulator.rawItemKeys.add(key);
  accumulator.rawItems.push({ ...item, postUrl, sourcePostUrl: postUrl });

  const existingPost = accumulator.posts.get(postUrl);
  const postDate = normalizePostDate(item.postDate);
  accumulator.posts.set(postUrl, {
    postUrl,
    ...(existingPost?.postDate ? { postDate: existingPost.postDate } : postDate ? { postDate } : {})
  });
  addCandidate(accumulator.candidates, { ...item, postUrl, sourcePostUrl: postUrl });
  return true;
}

export async function resolveCollectedPostsUntilTarget(input: {
  browser: InstagramCompetitorDiscoveryBrowser;
  accumulator: InstagramDiscoveryAccumulator;
  targetCompetitors: number;
}): Promise<void> {
  for (const post of input.accumulator.posts.values()) {
    if (input.accumulator.candidates.size >= input.targetCompetitors) return;
    if (input.accumulator.resolvedPosts.has(post.postUrl)) continue;
    input.accumulator.resolvedPosts.add(post.postUrl);
    const candidate = await input.browser.resolvePostProfile(post.postUrl);
    const datedCandidate = candidate && post.postDate ? { ...candidate, postDate: candidate.postDate ?? post.postDate } : candidate;
    const added = datedCandidate ? addCandidate(input.accumulator.candidates, datedCandidate) : false;
    if (added) {
      input.accumulator.postOnlyByUrl.delete(post.postUrl);
    } else if (!hasCandidateForPost(input.accumulator.candidates, post.postUrl)) {
      input.accumulator.postOnlyByUrl.set(post.postUrl, {
        postUrl: post.postUrl,
        ...(post.postDate ? { postDate: post.postDate } : {}),
        status: "profile_not_found"
      });
    }
  }
}

export function getPostOnlyRecords(input: {
  accumulator: InstagramDiscoveryAccumulator;
  browserSupportsModalCollection: boolean;
}): InstagramPostOnlyRecord[] {
  if (!input.browserSupportsModalCollection) return [...input.accumulator.postOnlyByUrl.values()];

  const postOnly: InstagramPostOnlyRecord[] = [];
  for (const post of input.accumulator.posts.values()) {
    if (!hasCandidateForPost(input.accumulator.candidates, post.postUrl)) {
      postOnly.push({ postUrl: post.postUrl, status: "profile_not_found" });
    }
  }
  return postOnly;
}

export function collectDiscoveryItemsFromCapturedResponses(responses: Array<{
  responseUrl: string;
  bodyText: string;
}>): InstagramDiscoveryRawItem[] {
  const parsed: InstagramRawJsonResponse[] = [];
  for (const response of responses) {
    try {
      parsed.push({
        responseUrl: response.responseUrl,
        body: JSON.parse(response.bodyText) as unknown
      });
    } catch {
      // Ignore non-JSON bodies; DOM scan still runs.
    }
  }

  const collected = collectInstagramRecordsFromResponses(parsed);
  return mergeDiscoveryItems([
    ...collected.profiles.map((profile) => ({
      username: profile.username,
      bio: profile.bio,
      followers: profile.followers,
      following: profile.following,
      avatar: profile.profileImageUrl,
      profileUrl: profile.profileUrl
    })),
    ...collected.media.map((media) => ({
      username: media.username,
      postUrl: media.postUrl,
      sourcePostUrl: media.postUrl,
      postDate: media.timestamp
    }))
  ]);
}

export function mergeDiscoveryItems(items: InstagramDiscoveryRawItem[]): InstagramDiscoveryRawItem[] {
  const merged = new Map<string, InstagramDiscoveryRawItem>();
  for (const item of items) {
    const key = normalizeUsername(item.username) || normalizePostUrl(item.postUrl ?? item.sourcePostUrl);
    if (!key) continue;
    const existing = merged.get(key);
    merged.set(key, existing ? mergeDiscoveryItem(existing, item) : item);
  }
  return [...merged.values()];
}

export function getDiscoveryItemKey(item: InstagramDiscoveryRawItem): string {
  const username = normalizeUsername(item.username);
  if (username) return `username:${username}`;
  const postUrl = normalizePostUrl(item.postUrl ?? item.sourcePostUrl);
  return postUrl ? `post:${postUrl}` : "";
}

export function addCandidate(candidates: Map<string, InstagramCompetitorCandidate>, item: InstagramDiscoveryRawItem): boolean {
  const username = normalizeUsername(item.username);
  if (!username) return false;
  if (!hasProfileDetails(item)) return false;
  const sourcePostUrl = normalizePostUrl(item.sourcePostUrl ?? item.postUrl);
  if (!sourcePostUrl) return false;
  const existing = candidates.get(username);
  const next: InstagramCompetitorCandidate = {
    username,
    ...(typeof item.bio === "string" ? { bio: item.bio } : {}),
    ...(typeof item.following === "number" ? { following: item.following } : {}),
    ...(typeof item.followers === "number" ? { followers: item.followers } : {}),
    ...(typeof item.avatar === "string" ? { avatar: item.avatar } : {}),
    profileUrl: typeof item.profileUrl === "string" ? item.profileUrl : `https://www.instagram.com/${username}/`,
    sourcePostUrl,
    ...(normalizePostDate(item.postDate) ? { postDate: normalizePostDate(item.postDate) } : {}),
    status: "profile_found"
  };
  candidates.set(username, existing ? mergeCandidate(existing, next) : next);
  return true;
}

export function hasProfileDetails(item: InstagramDiscoveryRawItem): boolean {
  return typeof item.followers === "number" &&
    typeof item.following === "number" &&
    typeof item.avatar === "string" &&
    item.avatar.length > 0;
}

export function isDeadlineReached(deadlineMs: number | null): boolean {
  return deadlineMs !== null && Date.now() >= deadlineMs;
}

export function normalizeUsername(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/^@/, "").toLowerCase() : "";
}

export function normalizePostUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim(), "https://www.instagram.com");
    return url.hostname.endsWith("instagram.com") && isInstagramPostPath(url.pathname) ? url.toString() : "";
  } catch {
    return "";
  }
}

export function normalizePostDate(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

export function isSameInstagramPageUrl(left: string, right: string): boolean {
  if (!left || !right) return false;
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    const normalizePath = (path: string) => path.replace(/\/+$/, "") || "/";
    return leftUrl.hostname.endsWith("instagram.com") &&
      rightUrl.hostname.endsWith("instagram.com") &&
      normalizePath(leftUrl.pathname) === normalizePath(rightUrl.pathname);
  } catch {
    return false;
  }
}

function isInstagramPostPath(pathname: string): boolean {
  return /^\/(p|reel|tv)\/[^/]+\/?$/i.test(pathname);
}

function mergeCandidate(left: InstagramCompetitorCandidate, right: InstagramCompetitorCandidate): InstagramCompetitorCandidate {
  return {
    username: left.username,
    bio: left.bio || right.bio,
    following: left.following ?? right.following,
    followers: left.followers ?? right.followers,
    avatar: left.avatar || right.avatar,
    profileUrl: left.profileUrl || right.profileUrl,
    sourcePostUrl: left.sourcePostUrl || right.sourcePostUrl,
    postDate: left.postDate || right.postDate,
    status: "profile_found"
  };
}

function hasCandidateForPost(candidates: Map<string, InstagramCompetitorCandidate>, postUrl: string): boolean {
  const normalizedPostUrl = normalizePostUrl(postUrl);
  return [...candidates.values()].some((candidate) => normalizePostUrl(candidate.sourcePostUrl) === normalizedPostUrl);
}

function mergeDiscoveryItem(left: InstagramDiscoveryRawItem, right: InstagramDiscoveryRawItem): InstagramDiscoveryRawItem {
  return {
    ...left,
    ...Object.fromEntries(Object.entries(right).filter(([, value]) => (
      value !== undefined && value !== null && value !== ""
    )))
  };
}
