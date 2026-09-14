import { describe, it, expect } from "vitest";
import { parsePrometheus, parseLabels, findFamily, sumFamily } from "@/lib/prometheus/parse";
import { buildHistogram, histogramQuantile, cumulativeToPerBucket } from "@/lib/prometheus/histogram";
import { computeCostWindow, estimatePowerWatts, DEFAULT_ASSUMPTIONS } from "@/lib/cost/engine";
import { nextMockSnapshot } from "@/lib/metrics/mock";

const SAMPLE = `# HELP vllm:time_to_first_token_seconds TTFT histogram
# TYPE vllm:time_to_first_token_seconds histogram
vllm:time_to_first_token_seconds_bucket{le="0.1"} 10
vllm:time_to_first_token_seconds_bucket{le="0.5"} 18
vllm:time_to_first_token_seconds_bucket{le="1.0"} 20
vllm:time_to_first_token_seconds_bucket{le="+Inf"} 20
vllm:time_to_first_token_seconds_count 20
vllm:time_to_first_token_seconds_sum 4.2
# TYPE vllm:prompt_tokens_total counter
vllm:prompt_tokens_total{model="glm-5.3-flash"} 1000
# TYPE vllm:gpu_cache_usage_perc gauge
vllm:gpu_cache_usage_perc 0.42
# TYPE DCGM_FI_DEV_GPU_UTIL gauge
DCGM_FI_DEV_GPU_UTIL{gpu="0"} 75
`;

describe("prometheus parser", () => {
  it("parses families with types", () => {
    const fams = parsePrometheus(SAMPLE);
    const ttft = findFamily(fams, "vllm:time_to_first_token_seconds");
    expect(ttft).toBeDefined();
    expect(ttft?.type).toBe("histogram");
    const pt = findFamily(fams, "vllm:prompt_tokens_total");
    expect(pt?.type).toBe("counter");
    expect(sumFamily(pt)).toBe(1000);
  });

  it("parses labels with escapes", () => {
    expect(parseLabels('{le="0.5",model="glm"}')).toEqual({ le: "0.5", model: "glm" });
    expect(parseLabels('{msg="say \\"hi\\""}')).toEqual({ msg: 'say "hi"' });
    expect(parseLabels("")).toEqual({});
  });

  it("sums counters and reads gauges", () => {
    const fams = parsePrometheus(SAMPLE);
    expect(sumFamily(findFamily(fams, "vllm:gpu_cache_usage_perc"))).toBeCloseTo(0.42);
    expect(sumFamily(findFamily(fams, "DCGM_FI_DEV_GPU_UTIL"))).toBe(75);
  });
});

describe("histogram math", () => {
  it("computes quantiles with interpolation", () => {
    const h = buildHistogram([0.1, 0.5, 1.0, Number.POSITIVE_INFINITY], [10, 18, 20, 20]);
    // p50: target=10 → first bucket le=0.1 exactly hits → ~0.1
    expect(h.p50).toBeCloseTo(0.1, 2);
    // p95: target=19 → between 18@0.5 and 20@1.0 → 0.5 + 0.5*(19-18)/2 = 0.75
    expect(h.p95).toBeCloseTo(0.75, 2);
  });

  it("handles empty histograms", () => {
    expect(histogramQuantile([], [], 0.5)).toBeNull();
  });

  it("converts cumulative to per-bucket", () => {
    expect(cumulativeToPerBucket([10, 18, 20])).toEqual([10, 8, 2]);
  });
});

describe("cost engine", () => {
  it("estimates power from utilization", () => {
    const a = DEFAULT_ASSUMPTIONS;
    expect(estimatePowerWatts(null, a)).toBe(150); // midpoint assumption
    expect(estimatePowerWatts(0, a)).toBe(60);
    expect(estimatePowerWatts(1, a)).toBe(240);
  });

  it("computes $/1M from a window (second snapshot = real delta)", () => {
    const base = {
      ttftHistogram: { bounds: [], counts: [], p50: null, p95: null, p99: null },
      itlHistogram: { bounds: [], counts: [], p50: null, p95: null, p99: null },
      gpuUtil: 0.5, kvCacheUsage: 0.3,
      requestsTotal: 10, requestsFailedTotal: 0, families: [],
      numRequestsRunning: 0, numRequestsWaiting: 0,
    };
    const first = { ...base, ts: Date.now(), source: "mock" as const,
      promptTokensTotal: 1000, generationTokensTotal: 4000 };
    const costFirst = computeCostWindow(first, null, DEFAULT_ASSUMPTIONS);
    // First snapshot: cost accrues (idle GPUs are not free) but tokens are 0
    // because cumulative counters say nothing about a recent window.
    expect(costFirst.costUsd).toBeGreaterThan(0);
    expect(costFirst.tokens).toBe(0);
    expect(costFirst.costPer1MTokens).toBeNull();

    const second = { ...first, ts: first.ts + 60_000,
      promptTokensTotal: 2000, generationTokensTotal: 8000 };
    const cost = computeCostWindow(second, first, DEFAULT_ASSUMPTIONS);
    // 60s window at util 0.5 → 150W/node × 2 nodes = 0.005 kWh → $0.0006 energy
    // + hardware 0.305/60 + overhead 0.02/60
    expect(cost.costUsd).toBeGreaterThan(0);
    expect(cost.tokens).toBe(5000);
    expect(cost.costPer1MTokens).toBeCloseTo((cost.costUsd / 5000) * 1e6, 5);
  });
});

describe("mock source", () => {
  it("produces plausible snapshots", () => {
    const s = nextMockSnapshot(null);
    expect(s.source).toBe("mock");
    expect(s.gpuUtil).toBeGreaterThan(0);
    expect(s.generationTokensTotal).toBeGreaterThan(0);
    const s2 = nextMockSnapshot(s);
    expect(s2.generationTokensTotal).toBeGreaterThanOrEqual(s.generationTokensTotal);
  });
});
