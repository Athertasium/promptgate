import { NextResponse } from "next/server";
import { getDb } from "../../../lib/db";

export async function GET() {
  const db = getDb();

  const THRESHOLD = 0.92;

  const [exactStats, semanticPoints] = await Promise.all([
    db.request.aggregate({
      _count: { id: true },
      _sum: { cost_usd: true },
    }),
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

  const [cacheHits] = await Promise.all([
    db.request.aggregate({
      _count: { id: true },
      where: { cache_hit: true },
    }),
  ]);

  const total = exactStats._count.id;
  const hits = cacheHits._count.id;

  return NextResponse.json({
    exactHitRate: total > 0 ? hits / total : 0,
    exactHits: hits,
    totalRequests: total,
    savedCost: Number(exactStats._sum.cost_usd ?? 0),
    threshold: THRESHOLD,
    semanticPoints: semanticPoints.map((p) => ({
      score: p.similarity_score,
      wouldHit: p.would_have_hit,
      at: p.created_at,
    })),
  });
}
