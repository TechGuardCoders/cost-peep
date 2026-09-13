/**
 * Aggregations: tenant / model / route breakdowns from a snapshot window.
 *
 * Live vLLM metrics expose some of this via labels (model, route); tenant
 * attribution arrives when traffic flows through the Ball Knowledge gateway
 * (per-tenant request logs). Until then tenants come from gateway logs if
 * present, else a single "cluster" tenant.
 */
import type {
  MetricsSnapshot,
  TenantBreakdown,
  ModelBreakdown,
  RouteBreakdown,
  TrendPoint,
  CostWindow,
} from "../types";
import { findFamily } from "../prometheus/parse";

const TENANT_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#f87171", "#f472b6"];

export function tenantBreakdowns(current: MetricsSnapshot, prev: MetricsSnapshot | null, cost: CostWindow): TenantBreakdown[] {
  // Path 1: gateway logs marked tenants (future integration with project 6).
  // Path 2: single-tenant cluster view.
  const tokens = Math.max(0, cost.tokens);
  return [
    {
      tenantId: "cluster",
      name: "Cluster (single tenant)",
      color: TENANT_COLORS[0] ?? "#38bdf8",
      requests: current.requestsTotal - (prev?.requestsTotal ?? 0),
      promptTokens: Math.max(0, current.promptTokensTotal - (prev?.promptTokensTotal ?? 0)),
      completionTokens: Math.max(0, current.generationTokensTotal - (prev?.generationTokensTotal ?? 0)),
      costUsd: cost.costUsd,
      costPer1M: cost.costPer1MTokens,
      ttftP50Sec: current.ttftHistogram.p50,
      ttftP95Sec: current.ttftHistogram.p95,
      errorRate:
        current.requestsTotal > 0
          ? (current.requestsFailedTotal - (prev?.requestsFailedTotal ?? 0)) /
            Math.max(1, current.requestsTotal - (prev?.requestsTotal ?? 0))
          : 0,
    },
  ];
}

export function modelBreakdowns(current: MetricsSnapshot, prev: MetricsSnapshot | null, cost: CostWindow): ModelBreakdown[] {
  const out: ModelBreakdown[] = [];
  const seen = new Map<string, { requests: number; tokens: number }>();

  // vLLM counters carry a model_name label (older builds: model); use
  // per-model generation tokens if present.
  const genFam = findFamily(current.families, "vllm:generation_tokens_total");
  if (genFam && genFam.samples.some((s) => s.labels.model_name ?? s.labels.model)) {
    for (const s of genFam.samples) {
      const model = s.labels.model_name ?? s.labels.model ?? "unknown";
      const prevSample =
        prev && prev.source === current.source
          ? findFamily(prev.families, "vllm:generation_tokens_total")?.samples.find(
              (x) => (x.labels.model_name ?? x.labels.model) === model
            )
          : undefined;
      const delta = Math.max(0, s.value - (prevSample?.value ?? 0));
      const entry = seen.get(model) ?? { requests: 0, tokens: 0 };
      entry.tokens += delta;
      seen.set(model, entry);
    }
  }

  if (seen.size === 0) {
    seen.set("glm-5.3-flash", {
      requests: current.requestsTotal - (prev?.requestsTotal ?? 0),
      tokens: Math.max(0, cost.tokens),
    });
  }

  for (const [model, agg] of seen) {
    const share = cost.tokens > 0 ? agg.tokens / cost.tokens : 0;
    const modelCost = cost.costUsd * share;
    out.push({
      model,
      requests: agg.requests,
      tokens: agg.tokens,
      costUsd: modelCost,
      costPer1M: agg.tokens > 0 ? (modelCost / agg.tokens) * 1_000_000 : null,
    });
  }
  return out;
}

export function routeBreakdowns(current: MetricsSnapshot, prev: MetricsSnapshot | null, cost: CostWindow): RouteBreakdown[] {
  // vLLM does not label by HTTP route; when fronted by the gateway (project 6)
  // routes come from there. Default: the chat completions route carries all.
  const tokens = Math.max(0, cost.tokens);
  const reqs = Math.max(0, current.requestsTotal - (prev?.requestsTotal ?? 0));
  return [
    {
      route: "/v1/chat/completions",
      requests: reqs,
      tokens,
      costUsd: cost.costUsd,
      costPer1M: cost.costPer1MTokens,
      errorRate:
        reqs > 0
          ? (current.requestsFailedTotal - (prev?.requestsFailedTotal ?? 0)) / reqs
          : 0,
    },
  ];
}

export function appendTrendPoint(
  trends: TrendPoint[],
  current: MetricsSnapshot,
  prev: MetricsSnapshot | null,
  cost: CostWindow,
  maxPoints = 120
): TrendPoint[] {
  const dtSec = prev ? Math.max(0.001, (current.ts - prev.ts) / 1000) : 60;
  const tps =
    (Math.max(0, current.generationTokensTotal - (prev?.generationTokensTotal ?? 0))) / dtSec;

  const point: TrendPoint = {
    ts: current.ts,
    ttftP50: current.ttftHistogram.p50,
    ttftP95: current.ttftHistogram.p95,
    itlP50: current.itlHistogram.p50,
    tokensPerSec: tps,
    gpuUtil: current.gpuUtil,
    costPer1M: cost.costPer1MTokens,
  };
  const next = [...trends, point];
  return next.slice(-maxPoints);
}
