/** Serialize a Float32Array to a Buffer for BLOB storage. */
export function toBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}

/** Deserialize a BLOB Buffer back to a Float32Array (copies for safe alignment). */
export function fromBlob(b: Buffer): Float32Array {
  const copy = Buffer.from(b)
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4)
}

/** Cosine similarity in [-1, 1]; returns 0 if either vector has zero magnitude. */
export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
