import { describe, it, expect } from 'vitest'
import {
  scanResponsesToStandardOutput,
  scanResponsesToCandidates,
} from '../src/content/parsers.js'

/* Synthetic fixtures that exercise the parser contract against
   the same payload shapes the original CDP scanner handles. They
   are NOT real IG responses (live shapes change without notice)
   but they cover the documented field paths the scanner walks.
   Hand-verification of a real IG capture happens in the manual
   smoke step of the plan. */

const profileResp = {
  responseUrl: 'https://www.instagram.com/api/v1/users/web_profile_info/?username=falah',
  body: {
    data: {
      user: {
        id: '7777777',
        pk: '7777777',
        username: 'falah',
        full_name: 'Falah Isnan',
        biography: 'building anubis',
        profile_pic_url: 'https://img/pp.jpg',
        follower_count: 12345,
        following_count: 200,
        media_count: 78,
        is_verified: false,
        is_private: false,
      },
    },
  },
}

const feedResp = {
  responseUrl: 'https://www.instagram.com/api/v1/feed/user/7777777/?count=2',
  body: {
    items: [
      {
        id: '111_222',
        code: 'CabcDEF',
        owner: { username: 'falah' },
        like_count: 1234,
        comment_count: 56,
        taken_at: 1700000000,
        caption: { text: 'Hello world' },
        media_type: 1,
        image_versions2: { candidates: [{ url: 'https://img/photo.jpg' }] },
      },
      {
        id: '333_444',
        code: 'CxyzABC',
        owner: { username: 'falah' },
        like_count: 999,
        comment_count: 12,
        taken_at: 1700001000,
        caption: { text: 'Second post' },
        media_type: 2,
        image_versions2: { candidates: [{ url: 'https://img/thumb.jpg' }] },
        video_versions: [{ url: 'https://v/video.mp4' }],
      },
    ],
  },
}

const topsearchResp = {
  responseUrl: 'https://www.instagram.com/web/search/topsearch/?query=coffee',
  body: {
    users: [
      {
        user: {
          username: 'coffeelover',
          full_name: 'Coffee Lover',
          profile_pic_url: 'https://img/pp1.jpg',
          follower_count: 5000,
        },
      },
      {
        user: {
          username: 'morningbrew',
          full_name: 'Morning Brew',
          follower_count: 8000,
        },
      },
    ],
  },
}

describe('scanResponsesToStandardOutput', () => {
  it('extracts ProfileData from a web_profile_info response', () => {
    const { profiles } = scanResponsesToStandardOutput([profileResp])
    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toMatchObject({
      platform: 'instagram',
      username: 'falah',
      profileUrl: 'https://www.instagram.com/falah/',
      fullName: 'Falah Isnan',
      followers: 12345,
      following: 200,
      postCount: 78,
    })
  })

  it('extracts PostData[] from a feed/user response', () => {
    const { posts } = scanResponsesToStandardOutput([feedResp])
    expect(posts).toHaveLength(2)
    expect(posts[0]).toMatchObject({
      platform: 'instagram',
      postUrl: 'https://www.instagram.com/p/CabcDEF/',
      likes: 1234,
      comments: 56,
      caption: 'Hello world',
      username: 'falah',
    })
    expect(posts[0].media).toMatchObject({ kind: 'image', urls: ['https://img/photo.jpg'] })
    expect(posts[1].media).toMatchObject({ kind: 'video', videoUrl: 'https://v/video.mp4' })
  })

  it('combines profile + feed into a single output', () => {
    const out = scanResponsesToStandardOutput([profileResp, feedResp])
    expect(out.profiles).toHaveLength(1)
    expect(out.posts).toHaveLength(2)
    expect(out.posts[0].username).toBe('falah')
  })
})

describe('scanResponsesToCandidates', () => {
  it('extracts unique candidate usernames from a topsearch response', () => {
    const candidates = scanResponsesToCandidates([topsearchResp], 5)
    const usernames = candidates.map((c) => c.username).sort()
    expect(usernames).toContain('coffeelover')
    expect(usernames).toContain('morningbrew')
  })

  it('respects the targetCount cap', () => {
    const candidates = scanResponsesToCandidates([topsearchResp], 1)
    expect(candidates).toHaveLength(1)
  })

  it('falls back to media-owner usernames when no profile records', () => {
    const mediaOnly = {
      responseUrl: 'https://www.instagram.com/api/v1/discover/web/explore_grid/',
      body: {
        items: [
          {
            id: '900_x',
            code: 'Cexpl1',
            owner: { username: 'explorer1' },
            like_count: 1,
            comment_count: 0,
            taken_at: 1700000000,
            display_url: 'https://img/e.jpg',
          },
        ],
      },
    }
    const candidates = scanResponsesToCandidates([mediaOnly], 5)
    expect(candidates.map((c) => c.username)).toContain('explorer1')
  })
})
