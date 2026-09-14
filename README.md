# Cost Peep

**Cost-per-token dashboard for a self-hosted inference cluster.**

TTFT, ITL, GPU utilization and **$/1M tokens** by model, tenant and route.
Because infra without FinOps is just expensive uptime.

![CI](https://github.com/TechGuardCoders/cost-peep/actions/workflows/ci.yml/badge.svg)

## Why

GPU clusters bill by the hour; users by the token. Between those two numbers
lives every infrastructure decision that matters: how much a request really
costs, which tenant is burning money, and whether an optimization actually
paid. Cost Peep makes that number visible, continuously, against real
serving telemetry.

## What it shows

| Panel | What | Source |
|---|---|---|
| KPI row | $/1M tokens, TTFT p50/p95/p99, ITL p50, GPU util, avg tok/s, concurrent usage | vLLM `/metrics` histograms + cost engine |
| Trends | TTFT p50/p95 over time, throughput (instant + rolling avg), GPU util, $/1M trend | rolling 120-point ring |
| Distribution | TTFT histogram bands, cost by model | per-bucket histogram counts |
| Tables | by tenant, by model, by route | aggregation from labeled counters |

Timestamps render in the **America/New_York (Eastern)** timezone as
`DD/MM/YYYY HH:MM:SS`.

## The cost model

```
window cost = energy + hardware amortization + overhead
  energy   = avg power (W) x node count x hours x $/kWh
  power    = idle + gpu_util x (load - idle)        # 60W idle / 240W load per node
  hardware = $8,000 cluster / 36 months / 730 hrs = ~$0.305/hr
  overhead = $0.02/hr

$/1M tokens = window cost / tokens served x 1,000,000
```

All assumptions are editable at runtime: `POST /api/assumptions`
`{"ratePerKwh": 0.12, "loadWattsPerNode": 240, ...}`.

## Architecture

```
+--------------+   GET /metrics (read-only)   +------------------+
| vLLM cluster | ---------------------------> | Next.js server   |
| (any vLLM    |   Prometheus exposition      |  parse -> derive |
|  deployment) |   text format                |  cost engine     |
+--------------+                              +--------+---------+
                                                       | JSON
                                              +--------v---------+
                                              | Dashboard (SPA)  |
                                              | KPIs, charts,    |
                                              | breakdowns       |
                                              +------------------+
```

- **Read-only by design.** The collector only ever GETs `/metrics`.
  The serving stack is never touched, reconfigured, or restarted.
- **Mock mode** simulates realistic telemetry for CI and demos, using the
  same shapes as the live path. The UI cannot tell the difference; the badge
  says which one you are looking at.
- **Live failures degrade honestly.** The badge flips to stale and shows the
  error; the dashboard never fabricates numbers.

## Universal by design

Cost Peep is not tied to one cluster. It works against **any vLLM
deployment** (or anything else serving Prometheus exposition format), and
runs anywhere Node runs:

### 1. Run locally (mock mode, zero setup)

```bash
npm install
npm run dev          # http://localhost:3000, simulated telemetry
```

No inference server needed. This is the mode CI uses, and the mode the
hosted demo runs.

### 2. Run locally (live mode, against your cluster)

```bash
COST_PEEP_MODE=live VLLM_BASE_URL=http://your-vllm-host:8000 npm run dev
```

Point `VLLM_BASE_URL` at any reachable vLLM server. The `/metrics` endpoint
is scraped read-only; no API key is required for telemetry (only for
generating inference load with `scripts/generate_load.py`).

### 3. Docker

```bash
docker build -t cost-peep .
docker run -p 3000:3000 cost-peep                                   # mock
docker run -p 3000:3000 \
  -e COST_PEEP_MODE=live \
  -e VLLM_BASE_URL=http://your-vllm-host:8000 \
  cost-peep                                                         # live
```

### 4. Vercel (one click)

Deploy with the button or `vercel` CLI. The hosted deployment runs in mock
mode by default (set in `vercel.json`), which makes the project clickable
from the repo README with zero credentials. To run a live Vercel deployment
against a cloud-reachable vLLM endpoint, set `COST_PEEP_MODE=live` and
`VLLM_BASE_URL` in the Vercel project settings.

> A LAN-only cluster (like ours) is not reachable from a public Vercel
> deployment. Live-from-cloud requires either exposing the endpoint through
> an authenticated proxy or running the collector on the same network / VPN
> mesh as the cluster.

## Tests

```bash
npm test             # unit: parser, histogram quantiles, cost engine
```

The parser and quantile math are covered against hand-computed fixtures.
p95 interpolation matches Prometheus's own `histogram_quantile()` semantics.

## What is real vs simulated

- Parser, histogram quantiles, cost math: **real, unit-tested**.
- Mock telemetry: **simulated**, clearly badged `MOCK` in the UI.
- Live scrape: **real** against the cluster; enabled by env, badge shows `LIVE`.

---

<a href="https://techguard.io"><img src="public/tg-logo-dark.svg" alt="Tech Guard" height="28" align="left"></a>
**POWERED BY** [Tech Guard](https://techguard.io) - engineering and security under one roof.
