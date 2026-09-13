/**
 * Cost engine: turn serving metrics + power/hardware assumptions into
 * $/1M tokens. This is the FinOps core of Cost Peep.
 *
 * The model:
 *   Running the cluster costs money every hour whether tokens flow or not.
 *   We split hourly cost into:
 *     - energy:   avg GPU/node power draw (watts) × hours × $/kWh
 *     - hardware: amortized purchase price ÷ months ÷ 730 hrs
 *     - overhead: network, rack, misc — small flat adder
 *
 *   $/1M tokens = (window cost $) ÷ (tokens served) × 1,000,000
 *
 * Power is estimated from GPU utilization (DCGM-style gauge) because vLLM's
 * /metrics does not expose watts directly: power ≈ idle + util × (max-idle).
 * On the DGX Spark pair we model each node at 240W under load / 60W idle.
 */
import type { CostWindow, MetricsSnapshot } from "../types";

export interface CostAssumptions {
  /** $ per kWh of electricity. */
  ratePerKwh: number;
  /** Node idle power, watts. */
  idleWattsPerNode: number;
  /** Node power at full GPU utilization, watts. */
  loadWattsPerNode: number;
  /** Number of nodes in the serving path. */
  nodeCount: number;
  /** Hardware amortization $/hr for the whole cluster. */
  hardwarePerHour: number;
  /** Misc overhead $/hr (network, rack, maintenance). */
  overheadPerHour: number;
}

export const DEFAULT_ASSUMPTIONS: CostAssumptions = {
  ratePerKwh: 0.12, // US commercial average, editable in UI
  idleWattsPerNode: 60,
  loadWattsPerNode: 240,
  nodeCount: 2,
  // 2× DGX Spark ≈ $8,000 total, 36-month amortization: 8000/36/730 ≈ $0.305/hr
  hardwarePerHour: 0.305,
  overheadPerHour: 0.02,
};

/** Estimate average cluster power draw in watts from GPU utilization (0..1). */
export function estimatePowerWatts(util: number | null, a: CostAssumptions): number {
  if (util === null) {
    // No utilization signal: assume mid-load — conservative, flagged in UI.
    return (a.idleWattsPerNode + a.loadWattsPerNode) / 2;
  }
  const u = Math.min(1, Math.max(0, util));
  return a.idleWattsPerNode + u * (a.loadWattsPerNode - a.idleWattsPerNode);
}

/**
 * Compute the cost window from a snapshot + previous snapshot (for deltas).
 *
 * Live counters are cumulative since process start. The FIRST snapshot after
 * a (re)start has no previous — its counters say nothing about a recent
 * window, so we return a zero-token window (cost still accrues: idle GPUs
 * are not free) rather than crediting the process-lifetime tokens to one
 * 60-second window.
 */
export function computeCostWindow(
  current: MetricsSnapshot,
  previous: MetricsSnapshot | null,
  a: CostAssumptions
): CostWindow {
  const durationSec = previous ? Math.max(1, (current.ts - previous.ts) / 1000) : 60;
  const firstWindow = previous === null || previous.source !== current.source;

  const tokenDelta =
    current.generationTokensTotal + current.promptTokensTotal -
    (previous && !firstWindow
      ? previous.generationTokensTotal + previous.promptTokensTotal
      : 0);
  const tokens = firstWindow ? 0 : Math.max(0, tokenDelta);

  const avgPowerWatts = estimatePowerWatts(current.gpuUtil, a);
  const hours = durationSec / 3600;
  const energyKwh = (avgPowerWatts * a.nodeCount * hours) / 1000;

  const energyCost = energyKwh * a.ratePerKwh;
  const hardwareCost = a.hardwarePerHour * hours;
  const overheadCost = a.overheadPerHour * hours;
  const costUsd = energyCost + hardwareCost + overheadCost;

  return {
    durationSec,
    avgPowerWatts,
    energyKwh,
    ratePerKwh: a.ratePerKwh,
    hardwarePerHour: a.hardwarePerHour,
    costUsd,
    tokens: Math.max(0, tokens),
    costPer1MTokens: tokens > 0 ? (costUsd / tokens) * 1_000_000 : null,
  };
}
