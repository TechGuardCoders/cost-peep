/**
 * Server-side snapshot store: keeps the rolling window of metrics snapshots
 * in process memory. Global-This so dev hot-reload and route handlers share it.
 *
 * Window deltas: live vLLM counters are cumulative since process start, so
 * the "window" numbers (tokens served, cost) are deltas between consecutive
 * snapshots. The first live snapshot establishes the baseline — it contributes
 * no window cost, only totals.
 */
import type { MetricsSnapshot, TrendPoint, DashboardPayload } from "./types";
import { computeCostWindow, DEFAULT_ASSUMPTIONS, CostAssumptions } from "./cost/engine";
import {
  tenantBreakdowns,
  modelBreakdowns,
  routeBreakdowns,
  appendTrendPoint,
} from "./cost/aggregate";
import { nextMockSnapshot } from "./metrics/mock";

interface Store {
  current: MetricsSnapshot | null;
  previous: MetricsSnapshot | null;
  trends: TrendPoint[];
  assumptions: CostAssumptions;
  /** True when the current snapshot is the first from the live source. */
  firstLiveSeen: boolean;
  /** Cumulative gen tokens + ts at the start of the trend window. */
  windowStart: { ts: number; genTokens: number } | null;
}

const g = globalThis as unknown as { __costPeepStore?: Store };
if (!g.__costPeepStore) {
  g.__costPeepStore = {
    current: null,
    previous: null,
    trends: [],
    assumptions: { ...DEFAULT_ASSUMPTIONS },
    firstLiveSeen: false,
    windowStart: null,
  };
}
const store = g.__costPeepStore;

export function getAssumptions(): CostAssumptions {
  return store.assumptions;
}

export function setAssumptions(a: Partial<CostAssumptions>): CostAssumptions {
  store.assumptions = { ...store.assumptions, ...a };
  return store.assumptions;
}

/** Advance the store with a fresh snapshot, updating the trend ring. */
export function pushSnapshot(snap: MetricsSnapshot): void {
  // Source transition (mock seed → live): reset deltas so the first live
  // window isn't polluted by mock counters or by "cumulative since boot".
  if (snap.source === "live" && !store.firstLiveSeen) {
    store.previous = null;
    store.firstLiveSeen = true;
  }
  store.previous = store.current;
  store.current = snap;

  // Establish/reset the trend window on source transitions.
  if (snap.source === "live" && !store.firstLiveSeen) {
    store.windowStart = null;
    store.firstLiveSeen = true;
  }
  if (!store.windowStart) {
    store.windowStart = { ts: snap.ts, genTokens: snap.generationTokensTotal };
  }

  const cost = computeCostWindow(snap, store.previous, store.assumptions);
  const trends = appendTrendPoint(store.trends, snap, store.previous, cost);

  // Fill in the rolling avg on the newest point: cumulative tokens since
  // window start / elapsed. First point of a window has no elapsed time.
  const ws = store.windowStart;
  if (ws) {
    const elapsed = (snap.ts - ws.ts) / 1000;
    const last = trends[trends.length - 1];
    if (last && elapsed > 0.5) {
      last.tokensPerSecAvg = Math.max(0, snap.generationTokensTotal - ws.genTokens) / elapsed;
    }
  }

  store.trends = trends;
}

/** Seed the store with mock data (dev/demo/CI). */
export function seedMock(points = 30): void {
  for (let i = 0; i < points; i++) {
    const snap = nextMockSnapshot(store.current);
    pushSnapshot(snap);
  }
}

export function ensureData(): void {
  if (!store.current) seedMock(30);
}

export function buildPayload(): DashboardPayload {
  ensureData();
  const current = store.current;
  const previous = store.previous;
  if (!current) {
    return {
      current: {
        ttft: null, itl: null, gpuUtil: null, kvCacheUsage: null,
        cost: null, requestsTotal: 0, failedTotal: 0, source: "mock", uptimeSec: null,
        tokensPerSecAvg: null, numRequestsRunning: null, numRequestsWaiting: null,
      },
      tenants: [], models: [], routes: [], trends: [],
    };
  }
  const cost = computeCostWindow(current, previous, store.assumptions);
  return {
    current: {
      ttft: current.ttftHistogram,
      itl: current.itlHistogram,
      gpuUtil: current.gpuUtil,
      kvCacheUsage: current.kvCacheUsage,
      cost,
      requestsTotal: current.requestsTotal,
      failedTotal: current.requestsFailedTotal,
      source: current.source,
      uptimeSec: null,
      tokensPerSecAvg: store.trends.length > 1
        ? (store.trends[store.trends.length - 1]?.tokensPerSecAvg ?? null)
        : null,
      numRequestsRunning: current.numRequestsRunning,
      numRequestsWaiting: current.numRequestsWaiting,
    },
    tenants: tenantBreakdowns(current, previous, cost),
    models: modelBreakdowns(current, previous, cost),
    routes: routeBreakdowns(current, previous, cost),
    trends: store.trends,
  };
}
