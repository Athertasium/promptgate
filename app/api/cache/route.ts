import { NextResponse } from "next/server";
import { getDb } from "../../../lib/db";

export async function GET() {
  const db = getDb();

  const THRESHOLD = 0.92;

  const [allStats, cacheBreakdown, semanticPoints] = await Promise.all([
    db.request.aggregate({
      _count: { id: true },
      _sum: { cost_usd: true },
    }),
    db.$queryRaw<{ cache_type: string; count: number }[]>`
      SELECT
        COALESCE(cache_type, 'live') AS cache_type,
        COUNT(*)::int AS count
      FROM requests
      GROUP BY 1
    `,
    db.semanticCacheLog.findMany({
      orderBy: { created_at: "desc" },
      take: 500,
      select: {
        similarity_score: true,
        would_have_hit: true,
        created_at: true,
      },
    }),
  ]);

  const total = allStats._count.id ?? 0;
  const byType = Object.fromEntries(cacheBreakdown.map((r) => [r.cache_type, Number(r.count)]));
  const exactHits = byType["exact"] ?? 0;
  const semanticHitsCount = byType["semantic"] ?? 0;
  const totalHits = exactHits + semanticHitsCount;

  return NextResponse.json({
    exactHitRate: total > 0 ? exactHits / total : 0,
    semanticHitRate: total > 0 ? semanticHitsCount / total : 0,
    totalHitRate: total > 0 ? totalHits / total : 0,
    exactHits,
    semanticHits: semanticHitsCount,
    totalRequests: total,
    savedCost: Number(allStats._sum.cost_usd ?? 0),
    threshold: THRESHOLD,
    cacheTypeBreakdown: cacheBreakdown.map((r) => ({
      type: r.cache_type,
      count: Number(r.count),
    })),
    semanticPoints: semanticPoints.map((p) => ({
      score: p.similarity_score,
      wouldHit: p.would_have_hit,
      at: p.created_at,
    })),
  });
}
