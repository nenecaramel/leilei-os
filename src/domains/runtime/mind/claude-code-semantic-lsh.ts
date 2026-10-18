/**
 * Claude-only E5 (384-dimensional) locality-sensitive hash.
 * Uses ordinary PostgreSQL btree indexes, not pgvector/another database.
 * Deterministic across Railway workers and restarts.
 */
export const E5_DIMENSIONS = 384;
export const LSH_BANDS = 20;
export const LSH_BITS = 16;
export const LSH_ALGORITHM = "e5-small-lsh-v1";

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>> 0;
  };
}

export function mindLshBands(vector: readonly number[]): number[] {
  if (vector.length !== E5_DIMENSIONS ||
      vector.some(v => !Number.isFinite(v)) ||
      vector.every(v => v === 0)) throw new Error("Invalid E5 embedding.");
  const bands: number[] = [];
  for (let band = 0; band < LSH_BANDS; band++) {
    let bucket = 0;
    for (let bit = 0; bit < LSH_BITS; bit++) {
      const random = seeded((0x9e3779b9 ^ (band * 0x85ebca6b) ^
        (bit * 0xc2b2ae35)) >>> 0);
      let dot = 0;
      for (const value of vector) dot += (random() & 1 ? value : -value);
      if (dot >= 0) bucket |= (1 << bit);
    }
    bands.push(bucket);
  }
  return bands;
}

/** One-bit multiprobe improves synonym/wording recall without a full scan. */
export function mindLshProbes(vector: readonly number[]): Array<{band: number; bucket: number}> {
  return mindLshBands(vector).flatMap((bucket, band) => [
    {band, bucket},
    ...Array.from({length: LSH_BITS}, (_,bit) => ({
      band, bucket: bucket ^ (1 << bit),
    })),
  ]);
}
