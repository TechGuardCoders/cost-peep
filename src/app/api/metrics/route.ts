import { NextResponse } from "next/server";
import { buildPayload, pushSnapshot, ensureData } from "@/lib/store";
import { nextMockSnapshot } from "@/lib/metrics/mock";
import { fetchLiveSnapshot, LiveSourceConfig } from "@/lib/metrics/live";

export const dynamic = "force-dynamic";

/**
 * GET /api/metrics — current dashboard payload.
 *
 * Mode selection:
 *   COST_PEEP_MODE=live  → scrape vLLM /metrics each poll (read-only GET)
 *   COST_PEEP_MODE=mock  → simulated telemetry (default; CI/demo safe)
 *
 * Live failures fall back to the last good snapshot; the payload reports its
 * source so the UI can show a stale/live badge honestly.
 */
export async function GET() {
  ensureData();
  const mode = process.env.COST_PEEP_MODE ?? "mock";
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

  return NextResponse.json(buildPayload());
}
