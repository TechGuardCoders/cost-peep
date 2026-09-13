/**
 * Mock metrics source: realistic simulated vLLM telemetry.
 *
 * Used for: CI (no GPU hardware there), demos, and development. Shapes mirror
 * the live collector so the UI cannot tell the difference — same field names,
 * same histogram structures, realistic magnitudes (0.3-0.5s TTFT on a small
 * draft+verify MoE, 28-60 tok/s depending on workload).
 */
import type { MetricsSnapshot, HistogramData } from "../types";
import { buildHistogram } from "../prometheus/histogram";

let counterState = {
  promptTokens: 48_200_000,
  generationTokens: 19_400_000,
  requests: 312_400,
  failed: 187,
};

/** Deterministic-ish jitter so charts move but stay plausible. */
function jitter(base: number, pct: number): number {
  return base * (1 + (Math.random() - 0.5) * 2 * pct);
}

function mockTtftHistogram(load: number): HistogramData {
  // Buckets in seconds; counts shift right as load rises.
  const bounds = [0.1, 0.25, 0.5, 1, 2, 5, 10, Number.POSITIVE_INFINITY];
  const base = 1000;
  const shift = Math.floor(load * 2.2); // 0..2 buckets of shift
  const counts = bounds.map((_, i) => {
    const effective = Math.max(0, i - shift);
    return Math.floor(base * Math.pow(0.55, effective) * (1 + i * 0.35));
  });
  // make cumulative
  for (let i = 1; i < counts.length; i++) counts[i] = (counts[i - 1] ?? 0) + (counts[i] ?? 0);
  return buildHistogram(bounds, counts);
}

function mockItlHistogram(load: number): HistogramData {
  const bounds = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, Number.POSITIVE_INFINITY];
  const base = 2000;
  const counts = bounds.map((_, i) => {
    const penalty = 1 + load * i * 0.8;
    return Math.floor(base * Math.pow(0.6, i) * penalty);
  });
  for (let i = 1; i < counts.length; i++) counts[i] = (counts[i - 1] ?? 0) + (counts[i] ?? 0);
  return buildHistogram(bounds, counts);
}

export function nextMockSnapshot(prev: MetricsSnapshot | null): MetricsSnapshot {
  // Simulate a diurnal-ish load pattern: slow sine + noise.
  const t = Date.now() / 1000;
  const load = 0.35 + 0.3 * Math.sin(t / 90) + (Math.random() - 0.5) * 0.12;

  const dtSec = prev ? Math.max(1, (Date.now() - prev.ts) / 1000) : 60;
  const tokRate = jitter(14 * 4, 0.15) * (0.5 + load); // aggregate tok/s
  const newGen = Math.floor(tokRate * dtSec);
  const newPrompt = Math.floor(tokRate * dtSec * 2.6);
  const newReq = Math.floor((tokRate / 180) * dtSec * jitter(1, 0.3));

  counterState = {
    promptTokens: counterState.promptTokens + newPrompt,
    generationTokens: counterState.generationTokens + newGen,
    requests: counterState.requests + newReq,
    failed: counterState.failed + (Math.random() < 0.15 ? 1 : 0),
  };

  return {
    ts: Date.now(),
    source: "mock",
    ttftHistogram: mockTtftHistogram(load),
    itlHistogram: mockItlHistogram(load),
    gpuUtil: Math.min(0.98, Math.max(0.05, jitter(0.45 + load * 0.4, 0.1))),
    kvCacheUsage: Math.min(0.95, Math.max(0.1, jitter(0.3 + load * 0.5, 0.12))),
    promptTokensTotal: counterState.promptTokens,
    generationTokensTotal: counterState.generationTokens,
    requestsTotal: counterState.requests,
    requestsFailedTotal: counterState.failed,
    families: [],
  };
}
