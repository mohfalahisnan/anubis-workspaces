import type { Embedder } from './embedder.js'

const MODEL = 'Xenova/all-MiniLM-L6-v2'

export interface XenovaEmbedderOptions {
  /** Directory holding the vendored model cache (offline use). */
  cacheDir?: string
  /** When false, never fetch from the network (offline-first). Default: true. */
  allowRemoteModels?: boolean
}

/**
 * Local embedding model via @xenova/transformers, loaded lazily on first
 * embed() (constructing at boot is cheap). When `allowRemoteModels: false` and
 * `cacheDir` points at the bundled model, runs fully offline.
 */
export class XenovaEmbedder implements Embedder {
  readonly dim = 384
  // The transformers pipeline has loose types; kept as a deferred promise.
  private pipe: Promise<(text: string, opts: object) => Promise<{ data: ArrayLike<number> }>> | null =
    null

  constructor(private opts: XenovaEmbedderOptions = {}) {}

  private load() {
    if (!this.pipe) {
      this.pipe = import('@xenova/transformers').then(({ pipeline, env }) => {
        if (this.opts.cacheDir) env.cacheDir = this.opts.cacheDir
        if (this.opts.allowRemoteModels === false) env.allowRemoteModels = false
        return pipeline('feature-extraction', MODEL) as unknown as Promise<
          (text: string, opts: object) => Promise<{ data: ArrayLike<number> }>
        >
      })
    }
    return this.pipe
  }

  async embed(text: string): Promise<Float32Array> {
    const extractor = await this.load()
    const output = await extractor(text, { pooling: 'mean', normalize: true })
    return Float32Array.from(output.data)
  }
}
