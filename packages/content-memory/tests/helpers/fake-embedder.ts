import type { Embedder } from '../../src/embedding/embedder.js'

/**
 * Deterministic, offline embedder for tests. Bag-of-char-codes → normalized
 * vector, so identical text yields cosine 1 and similar text ranks higher.
 */
export class FakeEmbedder implements Embedder {
  readonly dim: number
  constructor(dim = 16) {
    this.dim = dim
  }

  async embed(text: string): Promise<Float32Array> {
    const v = new Float32Array(this.dim)
    for (let i = 0; i < text.length; i++) {
      const slot = i % this.dim
      v[slot] = (v[slot] ?? 0) + text.charCodeAt(i)
    }
    let norm = 0
    for (let i = 0; i < this.dim; i++) norm += (v[i] ?? 0) * (v[i] ?? 0)
    norm = Math.sqrt(norm) || 1
    for (let i = 0; i < this.dim; i++) v[i] = (v[i] ?? 0) / norm
    return v
  }
}
