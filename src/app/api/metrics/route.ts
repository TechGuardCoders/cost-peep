import { NextResponse } from "next/server";
import path from "node:path";
import { buildPayload, pushSnapshot, ensureData } from "@/lib/store";
import { nextMockSnapshot } from "@/lib/metrics/mock";
import { fetchLiveSnapshot, LiveSourceConfig } from "@/lib/metrics/live";
import { tenantFeed, specFeed, sliceFeed, reliabilityFeed } from "@/lib/feeds";

export const dynamic = "force-dynamic";

/**
 * GET /api/metrics — current dashboard payload.
 *
 * Mode selection:
 *   POCKET_WATCH_MODE=live  → scrape vLLM /metrics each poll (read-only GET)
 *   POCKET_WATCH_MODE=mock  → simulated telemetry (default; CI/demo safe)
 *
 * Live failures fall back to the last good snapshot; the payload reports its
 * source so the UI can show a stale/live badge honestly.
 *
 * Integration feeds (portfolio stack): tenant attribution from the Ball
 * Knowledge gateway, spec-decode acceptance (Truffle), slice shares
 * (Circuiter), reliability (Flunk). Each is best-effort: a down feed
 * shows "no data", never breaks the dashboard.
 */
export async function GET() {
  ensureData();
  const mode = process.env.POCKET_WATCH_MODE ?? "mock";
  const base = process.env.VLLM_BASE_URL;
  const apiKey = process.env.VLLM_API_KEY;

  if (mode === "live" && base) {
    try {
      const cfg: LiveSourceConfig = { baseUrl: base, apiKey };
      const snap = await fetchLiveSnapshot(cfg);
      pushSnapshot(snap);
    } catch (err) {
      // Keep serving the last good snapshot; surface the error honestly.
      const payload = buildPayload();
      return NextResponse.json({
        ...payload,
        liveError: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (mode === "mock") {
    pushSnapshot(nextMockSnapshot(null));
  }

  // Integration feeds (best-effort, non-blocking)
  const benchDir = path.resolve(process.cwd(), "benchmarks");
  const bkUrl = process.env.BK_BASE_URL ?? "http://127.0.0.1:3100";
  const [tenants] = await Promise.all([tenantFeed(bkUrl)]);

  return NextResponse.json({
    ...buildPayload(),
    feeds: {
      gatewayTenants: tenants,
      spec: specFeed(benchDir),
      slices: sliceFeed(benchDir),
      reliability: reliabilityFeed(),
    },
  });
}
