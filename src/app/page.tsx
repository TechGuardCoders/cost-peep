"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell,
  RadialBarChart, RadialBar, PolarAngleAxis,
} from "recharts";
import type { DashboardPayload, TrendPoint } from "@/lib/types";

/* ---------------- theme toggle ---------------- */

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("cp-theme", next ? "dark" : "light");
    setDark(next);
  }, []);
  return (
    <button
      onClick={toggle}
      className="text-xs px-3 py-1.5 rounded-full border transition-colors"
      style={{ borderColor: "var(--border)", color: "var(--fg-muted)" }}
      aria-label="Toggle theme"
    >
      {dark ? "☀ Light" : "☾ Dark"}
    </button>
  );
}

/* ---------------- footer branding ---------------- */

function PoweredBy() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    const id = setInterval(
      () => setDark(document.documentElement.classList.contains("dark")),
      500
    );
    return () => clearInterval(id);
  }, []);
  return (
    <a
      href="https://techguard.io"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 hover:opacity-80 transition-opacity"
      title="Tech Guard — engineering & security under one roof"
    >
      <span className="kpi-label">POWERED BY</span>
      {/* light theme -> dark logo; dark theme -> white logo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={dark ? "/tg-logo-light.svg" : "/tg-logo-dark.svg"}
        alt="Tech Guard"
        className="h-5 w-auto"
      />
    </a>
  );
}

/* ---------------- eastern time helpers ---------------- */

const TIME_OPTS: Intl.DateTimeFormatOptions = {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
};

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  timeZone: "America/New_York",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
};

/** HH:MM:SS in Eastern, always. */
function timeFmt(ts: number): string {
  return new Intl.DateTimeFormat("en-GB", TIME_OPTS).format(new Date(ts));
}

/** DD/MM/YYYY in Eastern. */
function dateFmt(ts: number): string {
  return new Intl.DateTimeFormat("en-GB", DATE_OPTS).format(new Date(ts));
}

/* ---------------- KPI card ---------------- */

function Kpi({
  label, value, unit, sub, squared = false, delay = 0, children,
}: {
  label: string; value: string; unit?: string; sub?: string;
  squared?: boolean; delay?: number; children?: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className={`kpi-card ${squared ? "squared" : "rounded"} rise`}
      style={{ animationDelay: `${delay}s` }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="kpi-label mb-2">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="kpi-value text-3xl font-semibold">{value}</span>
        {unit && <span className="text-sm" style={{ color: "var(--fg-muted)" }}>{unit}</span>}
      </div>
      {sub && <div className="mt-1.5 text-xs" style={{ color: "var(--fg-muted)" }}>{sub}</div>}
      {hover && children}
    </div>
  );
}

/* ---------------- chart helpers ---------------- */

const AXIS_STYLE = { fontSize: 11, fill: "var(--fg-muted)" };

const tooltipStyle = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  fontSize: 12,
  color: "var(--fg)",
};

function ChartPanel({ title, children, delay = 0 }: { title: string; children: React.ReactNode; delay?: number }) {
  return (
    <div className="panel rise" style={{ animationDelay: `${delay}s` }}>
      <div className="kpi-label mb-4">{title}</div>
      {children}
    </div>
  );
}

/* ---------------- main dashboard ---------------- */

export default function Home() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/metrics", { cache: "no-store" });
      const json = await res.json();
      setData(json);
      setLiveError(json.liveError ?? null);
    } catch {
      /* keep last good frame */
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [poll]);

  if (!data) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="kpi-label animate-pulse">Loading telemetry…</div>
      </main>
    );
  }

  const { current, tenants, models, routes, trends } = data;

  const ttft = current.ttft;
  const itl = current.itl;
  const cost = current.cost;

  const fmtSec = (v: number | null | undefined, digits = 3) =>
    v == null ? "—" : `${v.toFixed(digits)}`;
  const fmtUsd = (v: number | null | undefined) =>
    v == null ? "—" : `$${v.toFixed(4)}`;
  const fmtPct = (v: number | null | undefined) =>
    v == null ? "—" : `${(v * 100).toFixed(1)}%`;
  const fmtNum = (v: number | null | undefined, digits = 1) =>
    v == null ? "—" : v.toFixed(digits);

  const now = Date.now();

  const ttftHistData =
    ttft && ttft.bounds.length > 0
      ? ttft.bounds.map((b, i) => ({
          band: b === Number.POSITIVE_INFINITY ? "+∞" : `${b}s`,
          count: (ttft.counts[i] ?? 0) - (i === 0 ? 0 : (ttft.counts[i - 1] ?? 0)),
        }))
      : [];

  const trendData = trends.map((t) => ({ ...t, time: timeFmt(t.ts) }));

  const tokenSplit = [
    { name: "Prompt", value: tenants.reduce((a, t) => a + t.promptTokens, 0) },
    { name: "Completion", value: tenants.reduce((a, t) => a + t.completionTokens, 0) },
  ];
  const PIE_COLORS = ["var(--accent)", "#a78bfa"];

  const gpuGauge = current.gpuUtil ?? 0;

  return (
    <main className="min-h-screen w-full px-4 py-6 md:px-8 lg:px-10">
      {/* header */}
      <header className="flex items-center justify-between mb-6 rise">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cost Peep</h1>
          <p className="text-sm mt-1" style={{ color: "var(--fg-muted)" }}>
            Diagnostic center — TTFT · ITL · GPU · $/1M tokens · Eastern{" "}
            {dateFmt(now)} {timeFmt(now)} ET
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="text-xs px-2.5 py-1 rounded-full border"
            style={{ borderColor: "var(--border)" }}
          >
            {current.source === "live" ? (
              <span className="live-word" style={{ color: "#34d399" }}>LIVE</span>
            ) : (
              <span style={{ color: "#fbbf24" }}>MOCK</span>
            )}
          </span>
          <ThemeToggle />
        </div>
      </header>

      {liveError && (
        <div className="panel mb-6 text-xs" style={{ borderColor: "#f87171", color: "#f87171" }}>
          Live scrape failed: {liveError} — showing last good snapshot.
        </div>
      )}

      {/* KPI row 1 */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <Kpi
          squared
          label="$/1M Tokens"
          value={cost?.costPer1MTokens != null ? `$${cost.costPer1MTokens.toFixed(2)}` : "—"}
          sub={`@ ${(cost?.durationSec ?? 0).toFixed(0)}s window`}
          delay={0}
        />
        <Kpi
          label="TTFT p50 / p95"
          value={fmtSec(ttft?.p50)}
          unit="s"
          sub={`p95 ${fmtSec(ttft?.p95)} · p99 ${fmtSec(ttft?.p99)}`}
          delay={0.05}
        />
        <Kpi
          squared
          label="ITL p50"
          value={fmtSec(itl?.p50)}
          unit="s/tok"
          sub={`p95 ${fmtSec(itl?.p95)}`}
          delay={0.1}
        />
        <Kpi
          label="GPU Utilization"
          value={fmtPct(current.gpuUtil)}
          sub={`KV cache ${fmtPct(current.kvCacheUsage)}`}
          delay={0.15}
        />
        <Kpi
          squared
          label="Avg Tokens/sec"
          value={fmtNum(current.tokensPerSecAvg)}
          unit="tok/s"
          sub="rolling trend window"
          delay={0.2}
        >
          {/* sparkline: throughput over the trend window, appears on hover */}
          <div className="mt-3 chart-still">
            <ResponsiveContainer width="100%" height={56}>
              <AreaChart data={trendData.slice(-40)}>
                <Area type="monotone" dataKey="tokensPerSec" stroke="var(--accent)" strokeWidth={1.5} fill="var(--accent-soft)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Kpi>
        <Kpi
          label="Concurrent Usage"
          value={current.numRequestsRunning != null ? String(Math.round(current.numRequestsRunning)) : "—"}
          unit="running"
          sub={current.numRequestsWaiting != null ? `${Math.round(current.numRequestsWaiting)} queued` : undefined}
          delay={0.25}
        />
      </section>

      {/* trend charts — 3 across on desktop */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <ChartPanel title="TTFT OVER TIME (ET)" delay={0.28}>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trendData}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="time" tick={AXIS_STYLE} tickLine={false} axisLine={false} minTickGap={24} interval="preserveStartEnd" />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={44} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => `${l} ET`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="ttftP50" name="p50" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="ttftP95" name="p95" stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="THROUGHPUT — INSTANT vs ROLLING AVG" delay={0.32}>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="tpsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="time" tick={AXIS_STYLE} tickLine={false} axisLine={false} minTickGap={24} interval="preserveStartEnd" />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={44} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => `${l} ET`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="tokensPerSec" name="instant tok/s" stroke="var(--accent)" strokeWidth={2} fill="url(#tpsGrad)" isAnimationActive={false} />
              <Line type="monotone" dataKey="tokensPerSecAvg" name="rolling avg" stroke="#fbbf24" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="GPU UTILIZATION %" delay={0.36}>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="gpuGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#34d399" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="time" tick={AXIS_STYLE} tickLine={false} axisLine={false} minTickGap={24} interval="preserveStartEnd" />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} domain={[0, 1]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${((v as number) * 100).toFixed(1)}%`, "util"]} labelFormatter={(l) => `${l} ET`} />
              <Area type="monotone" dataKey="gpuUtil" stroke="#34d399" strokeWidth={2} fill="url(#gpuGrad)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartPanel>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <ChartPanel title="$/1M TOKENS TREND" delay={0.4}>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trendData}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="time" tick={AXIS_STYLE} tickLine={false} axisLine={false} minTickGap={24} interval="preserveStartEnd" />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={44} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`$${(v as number).toFixed(2)}`, "$/1M"]} labelFormatter={(l) => `${l} ET`} />
              <Line type="monotone" dataKey="costPer1M" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="TTFT DISTRIBUTION" delay={0.44}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={ttftHistData}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="band" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" name="requests" fill="var(--accent)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="CURRENT GPU LOAD" delay={0.48}>
          <ResponsiveContainer width="100%" height={200}>
            <RadialBarChart
              data={[{ name: "gpu", value: (current.gpuUtil ?? 0) * 100, fill: "#34d399" }]}
              innerRadius="70%"
              outerRadius="100%"
              startAngle={210}
              endAngle={-30}
            >
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
              <RadialBar background={{ fill: "var(--border)" }} dataKey="value" cornerRadius={8} isAnimationActive={false} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="text-center -mt-12 pb-4">
            <span className="kpi-value text-2xl font-semibold">{fmtPct(current.gpuUtil)}</span>
          </div>
        </ChartPanel>
      </section>

      {/* breakdowns */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 rise" style={{ animationDelay: "0.5s" }}>
        <div className="panel">
          <div className="kpi-label mb-4">BY TENANT</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs" style={{ color: "var(--fg-muted)" }}>
                <th className="pb-2">Tenant</th>
                <th className="pb-2 text-right">Cost</th>
                <th className="pb-2 text-right">$/1M</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.tenantId} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="py-2 flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: t.color }} />
                    {t.name}
                  </td>
                  <td className="py-2 text-right tabular-nums">{fmtUsd(t.costUsd)}</td>
                  <td className="py-2 text-right tabular-nums">{t.costPer1M != null ? `$${t.costPer1M.toFixed(2)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="kpi-label mb-4">BY MODEL</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs" style={{ color: "var(--fg-muted)" }}>
                <th className="pb-2">Model</th>
                <th className="pb-2 text-right">Tokens</th>
                <th className="pb-2 text-right">$/1M</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.model} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="py-2">{m.model}</td>
                  <td className="py-2 text-right tabular-nums">{m.tokens.toLocaleString()}</td>
                  <td className="py-2 text-right tabular-nums">{m.costPer1M != null ? `$${m.costPer1M.toFixed(2)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="kpi-label mb-4">BY ROUTE</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs" style={{ color: "var(--fg-muted)" }}>
                <th className="pb-2">Route</th>
                <th className="pb-2 text-right">Reqs</th>
                <th className="pb-2 text-right">$/1M</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.route} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="py-2 font-mono text-xs">{r.route}</td>
                  <td className="py-2 text-right tabular-nums">{r.requests.toLocaleString()}</td>
                  <td className="py-2 text-right tabular-nums">{r.costPer1M != null ? `$${r.costPer1M.toFixed(2)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* footer */}
      <footer className="mt-8 flex items-center justify-between text-xs" style={{ color: "var(--fg-muted)" }}>
        <span>
          Reads vLLM /metrics read-only · assumptions editable via POST /api/assumptions ·{" "}
          {dateFmt(now)} {timeFmt(now)} ET
        </span>
        <PoweredBy />
      </footer>
    </main>
  );
}
