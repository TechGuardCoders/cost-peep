/**
 * Domain types for Cost Peep.
 *
 * Everything the dashboard renders flows through these records — the metrics
 * collector produces them, the cost engine derives them, the UI consumes them.
 */

/** Identity of the workload that generated traffic. */
export interface Tenant {
  id: string;
  name: string;
  /** Blended $/hr charge for this tenant's share of the cluster, if allocated. */
  color: string;
}

/** One scrape window of raw serving metrics. */
export interface MetricsSnapshot {
  /** When the snapshot was taken (ms epoch). */
  ts: number;
  /** Source: "live" (vLLM /metrics) or "mock" (simulated). */
  source: "live" | "mock";
  /** TTFT seconds histogram cumulative bucket upper bounds + counts. */
  ttftHistogram: HistogramData;
  /** Inter-token latency seconds histogram. */
  itlHistogram: HistogramData;
  /** GPU cache/utilization gauges (0..1). */
  gpuUtil: number | null;
  kvCacheUsage: number | null;
  /** Counters since process start. */
  promptTokensTotal: number;
  generationTokensTotal: number;
  requestsTotal: number;
  requestsFailedTotal: number;
  /** Raw families for anything the UI wants beyond the curated fields. */
  families: import("./prometheus/parse").MetricFamily[];
}

export interface HistogramData {
  /** Cumulative bucket upper bounds (seconds). */
  bounds: number[];
  /** Cumulative counts per bucket. */
  counts: number[];
  /** Computed quantiles from the histogram (seconds). */
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

/** Cost allocation for one window. */
export interface CostWindow {
  /** Window length in seconds. */
  durationSec: number;
  /** Average GPU power draw in watts over the window. */
  avgPowerWatts: number | null;
  /** Energy consumed, kWh. */
  energyKwh: number;
  /** Blended electricity rate $/kWh. */
  ratePerKwh: number;
  /** Amortized hardware $/hr (purchase price / months / 730). */
  hardwarePerHour: number;
  /** Total cost for the window: energy + hardware + network/misc. */
  costUsd: number;
  /** Tokens billed in the window. */
  tokens: number;
  /** The headline: dollars per 1M tokens. */
  costPer1MTokens: number | null;
}

/** Per-tenant aggregation for tables + breakdown charts. */
export interface TenantBreakdown {
  tenantId: string;
  name: string;
  color: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  costPer1M: number | null;
  ttftP50Sec: number | null;
  ttftP95Sec: number | null;
  errorRate: number;
}

/** Per-model aggregation. */
export interface ModelBreakdown {
  model: string;
  requests: number;
  tokens: number;
  costUsd: number;
  costPer1M: number | null;
}

/** Per-route (endpoint) aggregation. */
export interface RouteBreakdown {
  route: string;
  requests: number;
  tokens: number;
  costUsd: number;
  costPer1M: number | null;
  errorRate: number;
}

/** A point on the live trend charts. */
export interface TrendPoint {
  ts: number;
  ttftP50: number | null;
  ttftP95: number | null;
  itlP50: number | null;
  tokensPerSec: number;
  gpuUtil: number | null;
  costPer1M: number | null;
}

/** Full payload the dashboard API returns. */
export interface DashboardPayload {
  current: {
    ttft: HistogramData | null;
    itl: HistogramData | null;
    gpuUtil: number | null;
    kvCacheUsage: number | null;
    cost: CostWindow | null;
    requestsTotal: number;
    failedTotal: number;
    source: "live" | "mock";
    uptimeSec: number | null;
  };
  tenants: TenantBreakdown[];
  models: ModelBreakdown[];
  routes: RouteBreakdown[];
  trends: TrendPoint[];
}
