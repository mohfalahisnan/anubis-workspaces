export type InstagramRawJsonResponse = {
  responseUrl: string;
  body: unknown;
};

export type InstagramProfileRecord = {
  username: string;
  profileUrl: string;
  fullName?: string;
  bio?: string;
  profileImageUrl?: string;
  followers?: number;
  following?: number;
  postCount?: number;
  isVerified?: boolean;
  isPrivate?: boolean;
  category?: string;
  externalUrl?: string;
  collectedAt: string;
  sourceResponseUrl?: string;
};

export type InstagramMediaAssets = {
  kind: "image" | "video" | "carousel";
  urls: string[];
  videoUrl?: string;
};

export type InstagramMediaRecord = {
  username: string;
  postUrl: string;
  likes: number;
  comment: number;
  timestamp: string;
  caption?: string;
  media?: InstagramMediaAssets;
};

type InternalInstagramMediaRecord = InstagramMediaRecord & {
  id: string;
  shortcode: string;
};

export type InstagramCollectedRecords = {
  profiles: InstagramProfileRecord[];
  media: InstagramMediaRecord[];
};

const SHORTCODE_PATH_SEGMENTS = new Set(["p", "reel", "tv"]);

export function extractInstagramShortcode(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (SHORTCODE_PATH_SEGMENTS.has(parts[index])) {
      const shortcode = parts[index + 1].trim();
      return shortcode ? shortcode : undefined;
    }
  }
  return undefined;
}

export function filterRecordsToShortcode(
  records: InstagramCollectedRecords,
  shortcode: string
): InstagramCollectedRecords {
  const target = shortcode.trim();
  const media = records.media.filter((post) => extractInstagramShortcode(post.postUrl) === target);
  const owners = new Set(media.map((post) => post.username.toLowerCase()).filter(Boolean));
  const profiles = owners.size > 0
    ? records.profiles.filter((profile) => owners.has(profile.username.toLowerCase()))
    : [];
  return { profiles, media };
}

export function collectInstagramRecordsFromResponses(
  responses: InstagramRawJsonResponse[],
  collectedAt = new Date().toISOString()
): InstagramCollectedRecords {
  const profiles = new Map<string, InstagramProfileRecord>();
  const media = new Map<string, InternalInstagramMediaRecord>();

  for (const response of responses) {
    for (const value of walkObjects(response.body)) {
      const profile = normalizeProfile(value, response.responseUrl, collectedAt);
      if (profile) {
        profiles.set(profile.username, mergeRecords(profiles.get(profile.username), profile));
      }

      const post = normalizeMedia(value, response.responseUrl, collectedAt);
      const key = post ? post.shortcode ?? post.id ?? post.postUrl : undefined;
      if (post && key) {
        media.set(key, mergeRecords(media.get(key), post));
      }
    }
  }

  return {
    profiles: [...profiles.values()],
    media: [...media.values()].map((post) => toMediaRecord(post, getSingleProfileUsername(profiles)))
  };
}

function normalizeProfile(value: Record<string, unknown>, sourceResponseUrl: string, collectedAt: string): InstagramProfileRecord | null {
  const username = pickString(value, ["username"]);
  if (!username) return null;
  if (!hasAnyKey(value, ["full_name", "biography", "profile_pic_url", "profile_pic_url_hd", "edge_followed_by", "follower_count"])) {
    return null;
  }

  return stripEmpty({
    username,
    profileUrl: `https://www.instagram.com/${username}/`,
    fullName: pickString(value, ["full_name", "fullName"]),
    bio: pickString(value, ["biography", "bio"]),
    profileImageUrl: pickString(value, ["profile_pic_url_hd", "profile_pic_url"]),
    followers: pickNumber(value, ["follower_count", "followers"]) ?? nestedCount(value.edge_followed_by),
    following: pickNumber(value, ["following_count", "following"]) ?? nestedCount(value.edge_follow),
    postCount: pickNumber(value, ["media_count", "postCount"]) ?? nestedCount(value.edge_owner_to_timeline_media),
    isVerified: pickBoolean(value, ["is_verified", "isVerified"]),
    isPrivate: pickBoolean(value, ["is_private", "isPrivate"]),
    category: pickString(value, ["category", "category_name"]),
    externalUrl: pickString(value, ["external_url", "externalUrl"]),
    collectedAt,
    sourceResponseUrl
  });
}

function normalizeMedia(value: Record<string, unknown>, sourceResponseUrl: string, collectedAt: string): InternalInstagramMediaRecord | null {
  const shortcode = pickString(value, ["shortcode", "code"]);
  const id = pickString(value, ["id", "media_id"]);
  const username = getMediaUsername(value);
  const postUrl = pickString(value, ["permalink"]) ?? (shortcode ? `https://www.instagram.com/p/${shortcode}/` : undefined);
  const likes = pickNumber(value, ["like_count", "likes"]) ?? nestedCount(value.edge_liked_by);
  const comment = pickNumber(value, ["comment_count", "comments"]) ?? nestedCount(value.edge_media_to_comment);
  const timestamp = normalizeTimestamp(value);

  if (!id || !shortcode || !postUrl || likes === undefined || comment === undefined || !timestamp) {
    return null;
  }

  const caption = extractCaption(value);
  const media = extractMedia(value);

  return {
    username: username ?? "",
    id,
    shortcode,
    postUrl,
    likes,
    comment,
    timestamp,
    ...(caption ? { caption } : {}),
    ...(media ? { media } : {})
  };
}

function extractMedia(value: Record<string, unknown>): InstagramMediaAssets | undefined {
  const children = getCarouselChildren(value);
  if (children.length > 0) {
    const urls: string[] = [];
    let videoUrl: string | undefined;
    for (const child of children) {
      const img = extractImageUrl(child);
      if (img) urls.push(img);
      if (!videoUrl) videoUrl = extractVideoUrl(child);
    }
    if (urls.length === 0 && !videoUrl) return undefined;
    return { kind: "carousel", urls, ...(videoUrl ? { videoUrl } : {}) };
  }

  const videoUrl = extractVideoUrl(value);
  const imageUrl = extractImageUrl(value);
  if (videoUrl) {
    return { kind: "video", urls: imageUrl ? [imageUrl] : [], videoUrl };
  }
  if (imageUrl) {
    return { kind: "image", urls: [imageUrl] };
  }
  return undefined;
}

function getCarouselChildren(value: Record<string, unknown>): Record<string, unknown>[] {
  const edges = isRecord(value.edge_sidecar_to_children) ? value.edge_sidecar_to_children.edges : undefined;
  if (Array.isArray(edges)) {
    return edges
      .map((edge) => (isRecord(edge) && isRecord(edge.node) ? edge.node : undefined))
      .filter(isRecord);
  }
  if (Array.isArray(value.carousel_media)) {
    return value.carousel_media.filter(isRecord);
  }
  return [];
}

function extractImageUrl(node: Record<string, unknown>): string | undefined {
  const direct = pickString(node, ["display_url", "display_src", "thumbnail_src"]);
  if (direct) return direct;
  const candidates = isRecord(node.image_versions2) ? node.image_versions2.candidates : undefined;
  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      const url = isRecord(candidate) ? pickString(candidate, ["url"]) : undefined;
      if (url) return url;
    }
  }
  return undefined;
}

function extractVideoUrl(node: Record<string, unknown>): string | undefined {
  const direct = pickString(node, ["video_url"]);
  if (direct) return direct;
  if (Array.isArray(node.video_versions)) {
    for (const version of node.video_versions) {
      const url = isRecord(version) ? pickString(version, ["url"]) : undefined;
      if (url) return url;
    }
  }
  return undefined;
}

function extractCaption(value: Record<string, unknown>): string | undefined {
  // Mobile API: caption is an object with a `text` field.
  if (isRecord(value.caption)) {
    const text = pickString(value.caption, ["text"]);
    if (text) return text;
  }
  // Some payloads carry caption as a bare string.
  const flat = pickString(value, ["caption"]);
  if (flat) return flat;
  // Web GraphQL: edge_media_to_caption.edges[0].node.text.
  const edges = isRecord(value.edge_media_to_caption) ? value.edge_media_to_caption.edges : undefined;
  if (Array.isArray(edges)) {
    for (const edge of edges) {
      const node = isRecord(edge) ? edge.node : undefined;
      const text = isRecord(node) ? pickString(node, ["text"]) : undefined;
      if (text) return text;
    }
  }
  return undefined;
}

function toMediaRecord(post: InternalInstagramMediaRecord, fallbackUsername: string | undefined): InstagramMediaRecord {
  return {
    username: post.username || fallbackUsername || "",
    likes: post.likes,
    comment: post.comment,
    postUrl: post.postUrl,
    timestamp: post.timestamp,
    ...(post.caption ? { caption: post.caption } : {}),
    ...(post.media ? { media: post.media } : {})
  };
}

function getSingleProfileUsername(profiles: Map<string, InstagramProfileRecord>): string | undefined {
  return profiles.size === 1 ? [...profiles.keys()][0] : undefined;
}

function* walkObjects(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* walkObjects(item);
    }
    return;
  }

  if (!isRecord(value)) return;
  yield value;
  for (const child of Object.values(value)) {
    yield* walkObjects(child);
  }
}

function mergeRecords<T extends Record<string, unknown>>(existing: T | undefined, next: T): T {
  if (!existing) return next;
  const merged = { ...existing };
  for (const [key, value] of Object.entries(next)) {
    if (isUseful(value) && !isUseful(merged[key])) {
      merged[key as keyof T] = value as T[keyof T];
    }
  }
  return merged;
}

function stripEmpty<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => isUseful(value))) as T;
}

function isUseful(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replaceAll(",", ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function pickBoolean(record: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function nestedCount(value: unknown): number | undefined {
  return isRecord(value) ? pickNumber(value, ["count"]) : undefined;
}

function getMediaUsername(value: Record<string, unknown>): string | undefined {
  const owner = isRecord(value.owner) ? pickString(value.owner, ["username"]) : undefined;
  if (owner) return owner;
  const user = isRecord(value.user) ? pickString(value.user, ["username"]) : undefined;
  return user ?? pickString(value, ["username", "ownerUsername"]);
}

function normalizeTimestamp(record: Record<string, unknown>): string | undefined {
  const text = pickString(record, ["taken_at", "taken_at_timestamp", "timestamp"]);
  if (text) {
    const parsed = Number(text);
    if (Number.isFinite(parsed)) return timestampFromNumber(parsed);

    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  const value = pickNumber(record, ["taken_at", "taken_at_timestamp", "timestamp"]);
  return value === undefined ? undefined : timestampFromNumber(value);
}

function timestampFromNumber(value: number): string | undefined {
  if (!value) return undefined;
  const millis = value < 10_000_000_000 ? value * 1000 : value;
  return new Date(millis).toISOString();
}

function hasAnyKey(record: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => key in record);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
