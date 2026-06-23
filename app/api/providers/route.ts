import { NextResponse } from "next/server";
import { getDb } from "../../../lib/db";

export async function GET() {
  const db = getDb();

  const [providerStats, recentFailovers] = await Promise.all([
    db.$queryRaw<
      { provider: string; total: number; failovers: number; last_failure: Date | null }[]
    >`
      SELECT
        COALESCE(served_by_provider, 'unknown') AS provider,
        COUNT(*)::int AS total,
        SUM(CASE WHEN failover_occurred THEN 1 ELSE 0 END)::int AS failovers,
        MAX(CASE WHEN failover_occurred THEN created_at END) AS last_failure
      FROM requests
      GROUP BY 1
      ORDER BY total DESC
    `,
    db.failoverEvent.findMany({
      orderBy: { created_at: "desc" },
      take: 50,
    }),
  ]);

  return NextResponse.json({
    providers: providerStats,
    recentFailovers,
  });
}
