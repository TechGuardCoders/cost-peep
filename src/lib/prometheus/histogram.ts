/**
 * Histogram math: convert cumulative Prometheus histogram buckets into
 * quantiles. This is the core of TTFT/ITL p50/p95/p99 computation.
 */
import type { HistogramData } from "../types";

/**
 * Compute a quantile from cumulative histogram buckets.
 *
 * Prometheus histograms are cumulative: bucket `le=X` holds the count of
 * observations <= X. To estimate quantile q:
 *   1. find the first bucket whose count >= q * totalCount
 *   2. linearly interpolate between that bucket's upper bound and the
 *      previous bucket's bound, proportional to how far into the bucket
 *      the quantile falls.
 *
 * This is the same linear interpolation Prometheus itself uses for
 * histogram_quantile() — good enough for dashboards, documented as an
 * estimate, not ground truth.
 */
export function histogramQuantile(bounds: number[], counts: number[], q: number): number | null {
  if (bounds.length === 0 || counts.length === 0) return null;
  if (bounds.length !== counts.length) return null;

  const total = counts[counts.length - 1] ?? 0;
  if (total <= 0) return null;

  const target = q * total;

  for (let i = 0; i < bounds.length; i++) {
    const c = counts[i] ?? 0;
    if (c >= target) {
      const prevCount = i === 0 ? 0 : (counts[i - 1] ?? 0);
      const prevBound = i === 0 ? 0 : (bounds[i - 1] ?? 0);
      const bucketWidth = (bounds[i] ?? 0) - prevBound;
      const frac = c - prevCount > 0 ? (target - prevCount) / (c - prevCount) : 0;
      return prevBound + bucketWidth * frac;
    }
  }
  // q beyond last bucket (shouldn't happen with +Inf bucket, but be safe)
  return bounds[bounds.length - 1] ?? null;
}

/**
 * Build a HistogramData from raw cumulative buckets, computing quantiles.
 * Bounds may include Infinity (the +Inf bucket) — quantiles ignore it for
 * interpolation but keep it for the total count.
 */
export function buildHistogram(
  rawBounds: number[],
  rawCounts: number[]
): HistogramData {
  // Sort by bound, keeping counts aligned.
  const pairs = rawBounds
    .map((b, i) => ({ b, c: rawCounts[i] ?? 0 }))
    .filter((p) => Number.isFinite(p.b) || p.b === Number.POSITIVE_INFINITY)
    .sort((a, b) => a.b - b.b);

  const bounds = pairs.map((p) => p.b);
  const counts = pairs.map((p) => p.c);

  // Ensure monotonic non-decreasing counts (cumulative).
  for (let i = 1; i < counts.length; i++) {
    const prev = counts[i - 1] ?? 0;
    if ((counts[i] ?? 0) < prev) {
      counts[i] = prev;
    }
  }

  return {
    bounds,
    counts,
    p50: histogramQuantile(bounds, counts, 0.5),
    p95: histogramQuantile(bounds, counts, 0.95),
    p99: histogramQuantile(bounds, counts, 0.99),
  };
}

/**
 * Convert cumulative buckets into per-bucket counts for chart rendering
 * ("how many requests landed in this latency band").
 */
export function cumulativeToPerBucket(counts: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < counts.length; i++) {
    const prev = i === 0 ? 0 : (counts[i - 1] ?? 0);
    out.push(Math.max(0, (counts[i] ?? 0) - prev));
  }
  return out;
}
