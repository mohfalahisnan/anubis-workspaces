import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  collectInstagramRecordsFromResponses,
  extractInstagramShortcode,
  filterRecordsToShortcode
} from '../src/core/instagram/instagram-json-scanner.js'

function response(body: unknown) {
  return [{ responseUrl: 'https://i.instagram.com/api/v1/feed/', body }]
}

test('extracts caption from web GraphQL edge_media_to_caption', () => {
  const { media } = collectInstagramRecordsFromResponses(
    response({
      id: '17900000000000000',
      shortcode: 'CabcDEF',
      edge_liked_by: { count: 1234 },
      edge_media_to_comment: { count: 56 },
      taken_at_timestamp: 1700000000,
      edge_media_to_caption: { edges: [{ node: { text: 'Hello world caption' } }] },
      is_video: false,
      display_url: 'https://img/photo.jpg'
    })
  )

  assert.equal(media.length, 1)
  assert.equal(media[0].caption, 'Hello world caption')
})

test('extracts caption from mobile API caption.text', () => {
  const { media } = collectInstagramRecordsFromResponses(
    response({
      id: '123_456',
      code: 'CxyzABC',
      like_count: 99,
      comment_count: 8,
      taken_at: 1700000000,
      caption: { text: 'Mobile caption' },
      media_type: 1,
      image_versions2: { candidates: [{ url: 'https://img/thumb.jpg' }] }
    })
  )

  assert.equal(media.length, 1)
  assert.equal(media[0].caption, 'Mobile caption')
})

test('extracts image media from web GraphQL display_url', () => {
  const { media } = collectInstagramRecordsFromResponses(
    response({
      id: '1',
      shortcode: 'Img1',
      edge_liked_by: { count: 1 },
      edge_media_to_comment: { count: 0 },
      taken_at_timestamp: 1700000000,
      is_video: false,
      display_url: 'https://img/photo.jpg'
    })
  )

  assert.deepEqual(media[0].media, { kind: 'image', urls: ['https://img/photo.jpg'] })
})

test('extracts video media from mobile API video_versions', () => {
  const { media } = collectInstagramRecordsFromResponses(
    response({
      id: '1',
      code: 'Vid1',
      like_count: 1,
      comment_count: 0,
      taken_at: 1700000000,
      media_type: 2,
      image_versions2: { candidates: [{ url: 'https://img/thumb.jpg' }] },
      video_versions: [{ url: 'https://v/video.mp4' }]
    })
  )

  assert.equal(media[0].media?.kind, 'video')
  assert.equal(media[0].media?.videoUrl, 'https://v/video.mp4')
  assert.deepEqual(media[0].media?.urls, ['https://img/thumb.jpg'])
})

test('extracts carousel media from edge_sidecar_to_children', () => {
  const { media } = collectInstagramRecordsFromResponses(
    response({
      id: '1',
      shortcode: 'Car1',
      edge_liked_by: { count: 1 },
      edge_media_to_comment: { count: 0 },
      taken_at_timestamp: 1700000000,
      edge_sidecar_to_children: {
        edges: [
          { node: { is_video: false, display_url: 'https://img/i1.jpg' } },
          { node: { is_video: true, display_url: 'https://img/i2.jpg', video_url: 'https://v/v2.mp4' } }
        ]
      }
    })
  )

  assert.equal(media[0].media?.kind, 'carousel')
  assert.deepEqual(media[0].media?.urls, ['https://img/i1.jpg', 'https://img/i2.jpg'])
  assert.equal(media[0].media?.videoUrl, 'https://v/v2.mp4')
})

test('omits media when no urls present', () => {
  const { media } = collectInstagramRecordsFromResponses(
    response({
      id: '1',
      shortcode: 'NoMedia',
      edge_liked_by: { count: 1 },
      edge_media_to_comment: { count: 0 },
      taken_at_timestamp: 1700000000
    })
  )

  assert.equal(media[0].media, undefined)
})

test('omits caption when none present', () => {
  const { media } = collectInstagramRecordsFromResponses(
    response({
      id: '1',
      shortcode: 'NoCap',
      edge_liked_by: { count: 1 },
      edge_media_to_comment: { count: 0 },
      taken_at_timestamp: 1700000000
    })
  )

  assert.equal(media.length, 1)
  assert.equal(media[0].caption, undefined)
})

test('extractInstagramShortcode reads post, reel, and tv permalinks', () => {
  assert.equal(extractInstagramShortcode('https://www.instagram.com/p/Cabc123/'), 'Cabc123')
  assert.equal(extractInstagramShortcode('https://www.instagram.com/reel/Cdef456/'), 'Cdef456')
  assert.equal(extractInstagramShortcode('https://www.instagram.com/tv/Cghi789/'), 'Cghi789')
  assert.equal(extractInstagramShortcode('https://www.instagram.com/p/Cabc123/?img_index=2'), 'Cabc123')
  assert.equal(extractInstagramShortcode('https://www.instagram.com/some.user/p/Cabc123/'), 'Cabc123')
})

test('extractInstagramShortcode returns undefined for profile and home URLs', () => {
  assert.equal(extractInstagramShortcode('https://www.instagram.com/some.user/'), undefined)
  assert.equal(extractInstagramShortcode('https://www.instagram.com/'), undefined)
  assert.equal(extractInstagramShortcode('not a url'), undefined)
})

test('filterRecordsToShortcode keeps only the target post and its owner profile', () => {
  const records = {
    profiles: [
      { username: 'target', profileUrl: 'https://www.instagram.com/target/', collectedAt: 'now' },
      { username: 'homefeed', profileUrl: 'https://www.instagram.com/homefeed/', collectedAt: 'now' }
    ],
    media: [
      { username: 'target', postUrl: 'https://www.instagram.com/p/Cwant/', likes: 10, comment: 1, timestamp: 't' },
      { username: 'homefeed', postUrl: 'https://www.instagram.com/p/Cnoise/', likes: 99, comment: 9, timestamp: 't' },
      { username: 'target', postUrl: 'https://www.instagram.com/reel/Cwant/', likes: 10, comment: 1, timestamp: 't' }
    ]
  }

  const filtered = filterRecordsToShortcode(records, 'Cwant')

  assert.equal(filtered.media.length, 2)
  assert.ok(filtered.media.every((m) => extractInstagramShortcode(m.postUrl) === 'Cwant'))
  assert.deepEqual(filtered.profiles.map((p) => p.username), ['target'])
})

test('filterRecordsToShortcode drops everything when no post matches', () => {
  const records = {
    profiles: [{ username: 'homefeed', profileUrl: 'https://www.instagram.com/homefeed/', collectedAt: 'now' }],
    media: [{ username: 'homefeed', postUrl: 'https://www.instagram.com/p/Cnoise/', likes: 99, comment: 9, timestamp: 't' }]
  }

  const filtered = filterRecordsToShortcode(records, 'Cmissing')

  assert.equal(filtered.media.length, 0)
  assert.equal(filtered.profiles.length, 0)
})
