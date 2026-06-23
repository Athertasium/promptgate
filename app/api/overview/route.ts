import { NextResponse } from "next/server";
import { getDb } from "../../../lib/db";

export async function GET() {
  const db = getDb();

  const [totals, byHourProvider, latencyRows, cacheStats] = await Promise.all([
    db.request.aggregate({
      _count: { id: true },
      _sum: { cost_usd: true },
    }),
    db.$queryRaw<{ hour: Date; provider: string; cost: number; count: number }[]>`
      SELECT
        date_trunc('hour', created_at) AS hour,
        COALESCE(served_by_provider, 'unknown') AS provider,
        COALESCE(SUM(cost_usd)::float, 0) AS cost,
        COUNT(*)::int AS count
      FROM requests
      WHERE created_at > now() - interval '24 hours'
      GROUP BY 1, 2
      ORDER BY 1
    `,
    db.$queryRaw<{ hour: Date; p50: number; p95: number }[]>`
      SELECT
        date_trunc('hour', created_at) AS hour,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
      FROM requests
      WHERE created_at > now() - interval '24 hours'
        AND latency_ms IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    `,
    db.request.aggregate({
      _count: { id: true },
      where: { cache_hit: true },
    }),
  ]);

  const totalRequests = totals._count.id;
  const totalCost = Number(totals._sum.cost_usd ?? 0);
  const cacheHitRate =
    totalRequests > 0 ? cacheStats._count.id / totalRequests : 0;

  return NextResponse.json({
    totalRequests,
    totalCost,
    cacheHitRate,
    costByHourProvider: byHourProvider.map((r) => ({
      hour: r.hour,
      provider: r.provider,
      cost: Number(r.cost),
      count: Number(r.count),
    })),
    latencyByHour: latencyRows.map((r) => ({
      hour: r.hour,
      p50: Number(r.p50 ?? 0),
      p95: Number(r.p95 ?? 0),
    })),
  });
}
