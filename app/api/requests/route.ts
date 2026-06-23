import { NextResponse } from "next/server";
import { getDb } from "../../../lib/db";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 50)));
  const tier = searchParams.get("tier") ?? undefined;
  const provider = searchParams.get("provider") ?? undefined;
  const cacheHit = searchParams.get("cache_hit");
  const failover = searchParams.get("failover");

  const db = getDb();

  const where = {
    ...(tier ? { tier } : {}),
    ...(provider ? { served_by_provider: provider } : {}),
    ...(cacheHit !== null ? { cache_hit: cacheHit === "true" } : {}),
    ...(failover !== null ? { failover_occurred: failover === "true" } : {}),
  };

  const [rows, total] = await Promise.all([
    db.request.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        created_at: true,
        tier: true,
        served_by_provider: true,
        served_by_model: true,
        input_tokens: true,
        output_tokens: true,
        cost_usd: true,
        latency_ms: true,
        cache_hit: true,
        failover_occurred: true,
        caller_id: true,
      },
    }),
    db.request.count({ where }),
  ]);

  return NextResponse.json({
    rows: rows.map((r) => ({ ...r, cost_usd: Number(r.cost_usd ?? 0) })),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
}
