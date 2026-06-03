/* Wire the generic Instagram JSON scanner into the shapes the
   Anubis backend expects (mirrors @anubis/research-crawler's
   standard-output ProfileData / PostData and DiscoveredCandidate
   from @anubis/shared). The scanner walks any IG response body
   and pulls profile/media records; we then re-map a small subset
   of fields for the backend's persistence layer. */

import {
  collectInstagramRecordsFromResponses,
  type InstagramCollectedRecords,
  type InstagramProfileRecord,
  type InstagramMediaRecord,
  type InstagramRawJsonResponse,
} from './ig-scanner.js'

export interface ProfileData {
  platform: 'instagram'
  username: string
  profileUrl: string
  fullName?: string
  bio?: string
  profileImageUrl?: string
  followers?: number
  following?: number
  postCount?: number
  isVerified?: boolean
  isPrivate?: boolean
  category?: string
  externalUrl?: string
  collectedAt?: string
  sourceResponseUrl?: string
}

export interface PostMedia {
  kind: 'image' | 'video' | 'carousel'
  urls: string[]
  videoUrl?: string
}

export interface PostData {
  platform: 'instagram'
  postUrl: string
  username?: string
  likes?: number
  comments?: number
  timestamp?: string
  caption?: string
  media?: PostMedia
}

export interface DiscoveredCandidate {
  username: string
  fullName?: string
  bio?: string
  followers?: number
  profileImageUrl?: string
  profileUrl?: string
}

/**
 * Reduce a collection of IG JSON responses into the standard
 * shape the backend persistence layer expects. `collectedAt` is
 * the moment of the scrape (ISO string).
 */
export function scanResponsesToStandardOutput(
  responses: InstagramRawJsonResponse[],
  collectedAt = new Date().toISOString(),
): { profiles: ProfileData[]; posts: PostData[] } {
  const records = collectInstagramRecordsFromResponses(responses, collectedAt)
  return {
    profiles: records.profiles.map(toProfileData),
    posts: records.media.map(toPostData),
  }
}

/**
 * Extract candidate usernames from any IG response. Used by the
 * discover flow to surface fresh competitor handles. Owner of a
 * scanned post is treated as a candidate even if no profile
 * record exists in the same response.
 */
export function scanResponsesToCandidates(
  responses: InstagramRawJsonResponse[],
  targetCount: number,
): DiscoveredCandidate[] {
  const records = collectInstagramRecordsFromResponses(responses)
  const byUsername = new Map<string, DiscoveredCandidate>()
  for (const profile of records.profiles) addCandidate(byUsername, fromProfile(profile))
  for (const media of records.media) {
    if (media.username) addCandidate(byUsername, { username: media.username, profileUrl: `https://www.instagram.com/${media.username}/` })
  }
  return [...byUsername.values()].slice(0, targetCount)
}

function toProfileData(p: InstagramProfileRecord): ProfileData {
  return {
    platform: 'instagram',
    username: p.username,
    profileUrl: p.profileUrl,
    fullName: p.fullName,
    bio: p.bio,
    profileImageUrl: p.profileImageUrl,
    followers: p.followers,
    following: p.following,
    postCount: p.postCount,
    isVerified: p.isVerified,
    isPrivate: p.isPrivate,
    category: p.category,
    externalUrl: p.externalUrl,
    collectedAt: p.collectedAt,
    sourceResponseUrl: p.sourceResponseUrl,
  }
}

function toPostData(m: InstagramMediaRecord): PostData {
  return {
    platform: 'instagram',
    postUrl: m.postUrl,
    username: m.username || undefined,
    likes: m.likes,
    comments: m.comment,
    timestamp: m.timestamp,
    caption: m.caption,
    media: m.media,
  }
}

function fromProfile(p: InstagramProfileRecord): DiscoveredCandidate {
  return {
    username: p.username,
    fullName: p.fullName,
    bio: p.bio,
    followers: p.followers,
    profileImageUrl: p.profileImageUrl,
    profileUrl: p.profileUrl,
  }
}

function addCandidate(map: Map<string, DiscoveredCandidate>, c: DiscoveredCandidate): void {
  if (!c.username) return
  const existing = map.get(c.username)
  if (!existing) { map.set(c.username, c); return }
  map.set(c.username, {
    username: c.username,
    fullName: existing.fullName ?? c.fullName,
    bio: existing.bio ?? c.bio,
    followers: existing.followers ?? c.followers,
    profileImageUrl: existing.profileImageUrl ?? c.profileImageUrl,
    profileUrl: existing.profileUrl ?? c.profileUrl,
  })
}
