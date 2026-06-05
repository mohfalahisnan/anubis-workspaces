/** Produces a unit-length embedding vector for a text. */
export interface Embedder {
  /** Output dimensionality (e.g. 384 for all-MiniLM-L6-v2). */
  readonly dim: number
  embed(text: string): Promise<Float32Array>
}
