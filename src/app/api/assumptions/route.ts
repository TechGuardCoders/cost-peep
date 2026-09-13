import { NextRequest, NextResponse } from "next/server";
import { setAssumptions, getAssumptions } from "@/lib/store";
import { CostAssumptions } from "@/lib/cost/engine";

export const dynamic = "force-dynamic";

/** GET /api/assumptions — current FinOps assumptions. */
export async function GET() {
  return NextResponse.json(getAssumptions());
}

/**
 * POST /api/assumptions — update rate/hardware/power assumptions.
 * Body: partial CostAssumptions JSON. Numbers only, validated.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const numericFields: (keyof CostAssumptions)[] = [
    "ratePerKwh", "idleWattsPerNode", "loadWattsPerNode", "nodeCount",
    "hardwarePerHour", "overheadPerHour",
  ];
  const update: Partial<CostAssumptions> = {};
  for (const field of numericFields) {
    const v = body[field];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      return NextResponse.json({ error: `${field} must be a non-negative number` }, { status: 400 });
    }
    update[field] = v;
  }

  return NextResponse.json(setAssumptions(update));
}
