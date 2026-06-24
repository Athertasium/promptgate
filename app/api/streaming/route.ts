import { NextResponse } from "next/server";
import { getDb } from "../../../lib/db";

export async function GET() {
  const db = getDb();

  const [ttftByProvider, ttftByHour] = await Promise.all([
    db.$queryRaw<{ provider: string; p50: number; p95: number; count: number }[]>`
      SELECT
        COALESCE(served_by_provider, 'unknown') AS provider,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ttft_ms) AS p50,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ttft_ms) AS p95,
        COUNT(*)::int AS count
      FROM requests
      WHERE ttft_ms IS NOT NULL
      GROUP BY 1
      ORDER BY count DESC
    `,
    db.$queryRaw<{ hour: Date; provider: string; p50: number; p95: number }[]>`
      SELECT
        date_trunc('hour', created_at) AS hour,
        COALESCE(served_by_provider, 'unknown') AS provider,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ttft_ms) AS p50,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ttft_ms) AS p95
      FROM requests
      WHERE ttft_ms IS NOT NULL
        AND created_at > now() - interval '24 hours'
      GROUP BY 1, 2
      ORDER BY 1
    `,
  ]);

  return NextResponse.json({
    byProvider: ttftByProvider.map((r) => ({
      provider: r.provider,
      p50: Number(r.p50 ?? 0),
      p95: Number(r.p95 ?? 0),
      count: Number(r.count),
    })),
    byHour: ttftByHour.map((r) => ({
      hour: r.hour,
      provider: r.provider,
      p50: Number(r.p50 ?? 0),
      p95: Number(r.p95 ?? 0),
    })),
  });
}
