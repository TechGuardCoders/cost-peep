# Cost Peep

**Cost-per-token dashboard for a self-hosted inference cluster.**

TTFT, ITL, GPU utilization and **$/1M tokens** — by model, tenant and route.
Because infra without FinOps is just expensive uptime.

![CI](https://github.com/TechGuardCoders/02-cost-peep/actions/workflows/ci.yml/badge.svg)

## Why

GPU clusters bill by the hour; users by the token. Between those two numbers
lives every infrastructure decision that matters: how much a request really
costs, which tenant is burning money, and whether an optimization actually
paid. Cost Peep makes that number visible, continuously, against real
serving telemetry.

## What it shows

| Panel | What | Source |
|---|---|---|
| KPI row | $/1M tokens, TTFT p50/p95/p99, ITL p50, GPU util | vLLM `/metrics` histograms + cost engine |
| Second row | window cost, tokens served, request totals, energy | counter deltas per window |
| Trends | TTFT p50/p95 over time, throughput, GPU util, $/1M trend | rolling 120-point ring |
| Distribution | TTFT histogram bands, token mix, cost by model | per-bucket histogram counts |
| Tables | by tenant, by model, by route | aggregation from labeled counters |

## The cost model

```
window cost = energy + hardware amortization + overhead
  energy   = avg power (W) × node count × hours × $/kWh
  power    ≈ idle + gpu_util × (load − idle)        # 60W idle / 240W load per node
  hardware = $8,000 cluster ÷ 36 months ÷ 730 hrs ≈ $0.305/hr
  overhead = $0.02/hr

$/1M tokens = window cost ÷ tokens served × 1,000,000
```

All assumptions are editable at runtime: `POST /api/assumptions`
`{"ratePerKwh": 0.12, "loadWattsPerNode": 240, ...}`.

## Architecture

```
┌──────────────┐   GET /metrics (read-only)   ┌──────────────────┐
│ vLLM cluster │ ───────────────────────────▶ │ Next.js server   │
│ (2× Spark,   │   Prometheus exposition      │  parse → derive  │
│  TP=2)       │   text format                │  cost engine     │
└──────────────┘                              └────────┬─────────┘
                                                       │ JSON
                                              ┌────────▼─────────┐
                                              │ Dashboard (SPA)  │
                                              │ KPIs·charts·tabs │
                                              └──────────────────┘
```

- **Read-only by design** — the collector only ever GETs `/metrics`.
  The serving stack is never touched, reconfigured, or restarted.
- **Mock mode** simulates realistic telemetry for CI and demos, using the
  same shapes as the live path — the UI cannot tell the difference.
- **Live failures degrade honestly** — the UI badge flips to stale and shows
  the error; it never fabricates numbers.

## Run it

```bash
npm install
npm run dev            # mock mode, http://localhost:3000

# live mode against the Spark cluster
COST_PEEP_MODE=live VLLM_BASE_URL=http://192.168.0.182:8000 npm run dev
```

## Tests

```bash
npm test               # unit: parser, histogram quantiles, cost engine
```

The parser and quantile math are covered against hand-computed fixtures —
p95 interpolation matches Prometheus's own `histogram_quantile()` semantics.

## What's real vs simulated

- Parser, histogram quantiles, cost math: **real, unit-tested**.
- Mock telemetry: **simulated**, clearly badged `MOCK` in the UI.
- Live scrape: **real** against the cluster; enabled by env, badge shows `LIVE`.
