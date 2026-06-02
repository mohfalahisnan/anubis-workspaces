import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  downloadGeneratedImages,
  ensureFlowChrome,
  findFlowTarget,
  isFlowVariationText,
  normalizeFlowGenerateInput,
  openFlowUrl,
  shouldTreatGenerationAsComplete
} from '../src/core/flow/flow-generate.js'

test('normalizes Flow generation defaults', () => {
  const input = normalizeFlowGenerateInput({ prompt: 'make product scene' })

  assert.equal(input.chromeOrigin, 'http://127.0.0.1:9224/')
  assert.equal(input.ratio, '1:1')
  assert.equal(input.variations, 4)
  assert.equal(input.model, 'Nano Banana Pro')
  assert.equal(input.tabUrlIncludes, '/tools/flow/project/')
  assert.equal(input.generateTimeoutMs, 120000)
})

test('rejects unsupported Flow options', () => {
  assert.throws(
    () => normalizeFlowGenerateInput({ prompt: 'x', ratio: '2:1' as never }),
    /Unsupported ratio/
  )
  assert.throws(
    () => normalizeFlowGenerateInput({ prompt: 'x', variations: 5 as never }),
    /Unsupported variations/
  )
})

test('finds the matching Flow Chrome target', async () => {
  const target = await findFlowTarget({
    chromeOrigin: 'http://127.0.0.1:9222',
    tabUrlIncludes: '/tools/flow/project/',
    fetchImpl: async () => new Response(JSON.stringify([
      { id: '1', type: 'page', url: 'https://example.com/', webSocketDebuggerUrl: 'ws://wrong' },
      { id: '2', type: 'page', url: 'https://labs.google/fx/id/tools/flow/project/abc', webSocketDebuggerUrl: 'ws://right' }
    ]), { status: 200 })
  })

  assert.equal(target.id, '2')
  assert.equal(target.webSocketDebuggerUrl, 'ws://right')
})

test('explains missing Flow Chrome debugging endpoint', async () => {
  await assert.rejects(
    () => findFlowTarget({
      chromeOrigin: 'http://127.0.0.1:9224/',
      tabUrlIncludes: '/tools/flow/project/',
      fetchImpl: async () => {
        throw new TypeError('fetch failed')
      }
    }),
    /Flow Chrome is not reachable at http:\/\/127\.0\.0\.1:9224\//
  )
})

test('ensures Flow Chrome with flow profile defaults', async () => {
  const calls: unknown[] = []
  const chromeOrigin = await ensureFlowChrome({
    url: 'https://labs.google/fx/id/tools/flow/project/abc',
    launchChrome: async (input) => {
      calls.push(input)
      return {
        ok: true,
        pid: 123,
        reused: false,
        remoteDebuggingPort: 9224,
        profile: 'flow',
        profileDir: 'data/chrome-profile-flow',
        url: input.url ?? '',
        headless: false,
        warnings: []
      }
    }
  })

  assert.equal(chromeOrigin, 'http://127.0.0.1:9224')
  assert.deepEqual(calls, [{
    url: 'https://labs.google/fx/id/tools/flow/project/abc',
    profile: 'flow'
  }])
})

test('opens Flow URL through Chrome debugging endpoint', async () => {
  const requested: string[] = []
  await openFlowUrl({
    chromeOrigin: 'http://127.0.0.1:9224',
    url: 'https://labs.google/fx/id/tools/flow/project/abc',
    fetchImpl: async (input, init) => {
      requested.push(`${init?.method ?? 'GET'} ${String(input)}`)
      return new Response('{}', { status: 200 })
    }
  })

  assert.equal(
    requested[0],
    'PUT http://127.0.0.1:9224/json/new?https%3A%2F%2Flabs.google%2Ffx%2Fid%2Ftools%2Fflow%2Fproject%2Fabc'
  )
})

test('matches Flow variation labels', () => {
  assert.equal(isFlowVariationText('1x', 1), true)
  assert.equal(isFlowVariationText('x1', 1), true)
  assert.equal(isFlowVariationText('x4', 4), true)
  assert.equal(isFlowVariationText('🍌 Nano Banana Pro\ncrop_square\nx4', 4), false)
})

test('treats generated image growth as completion', () => {
  assert.equal(shouldTreatGenerationAsComplete({
    beforeResultLinks: 8,
    resultLinks: 8,
    beforeImageUrls: 8,
    imageUrls: 12,
    variations: 4,
    progressing: false
  }), true)
  assert.equal(shouldTreatGenerationAsComplete({
    beforeResultLinks: 8,
    resultLinks: 12,
    beforeImageUrls: 8,
    imageUrls: 8,
    variations: 4,
    progressing: true
  }), false)
})

test('downloads generated images from page session', async () => {
  const downloadDir = await mkdtemp(join(tmpdir(), 'flow-generate-'))
  const calls: string[] = []
  try {
    const saved = await downloadGeneratedImages({
      eval: async <T>(expression: string): Promise<T> => {
        calls.push(expression)
        if (expression.includes('generatedImageUrls')) return ['https://img/one', 'https://img/two'] as T
        if (expression.includes('https://img/one')) return { b64: Buffer.from('one').toString('base64'), mime: 'image/png' } as T
        return { b64: Buffer.from('two').toString('base64'), mime: 'image/webp' } as T
      }
    }, {
      downloadDir,
      count: 2,
      filePrefix: 'sample'
    })

    assert.deepEqual(saved.map((item) => item.split(/[\\/]/).pop()), ['sample_01.png', 'sample_02.webp'])
    assert.equal((await readFile(saved[0], 'utf8')), 'one')
    assert.equal((await readFile(saved[1], 'utf8')), 'two')
    assert.ok(calls.some((item) => item.includes('__flowDl.generatedImageUrls().slice(-2)')))
  } finally {
    await rm(downloadDir, { recursive: true, force: true })
  }
})
