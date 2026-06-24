import { NextResponse } from "next/server";
import { getDb } from "../../../lib/db";

export async function GET() {
  const db = getDb();

  const [callerStats, keys] = await Promise.all([
    db.$queryRaw<
      { caller_id: string; requests: number; cost: number; tokens: number }[]
    >`
      SELECT
        COALESCE(caller_id, 'anonymous') AS caller_id,
        COUNT(*)::int AS requests,
        COALESCE(SUM(cost_usd)::float, 0) AS cost,
        COALESCE(SUM(input_tokens + output_tokens)::int, 0) AS tokens
      FROM requests
      GROUP BY 1
      ORDER BY requests DESC
      LIMIT 50
    `,
    db.apiKey.findMany({
      where: { revoked_at: null },
      select: {
        caller_id: true,
        rate_limit_rpm: true,
        allowed_tiers: true,
        created_at: true,
      },
      orderBy: { created_at: "desc" },
    }),
  ]);

  // last-minute utilization: requests per caller_id in last 60s vs their rpm limit
  const recentCounts = await db.$queryRaw<{ caller_id: string; recent: number }[]>`
    SELECT
      COALESCE(caller_id, 'anonymous') AS caller_id,
      COUNT(*)::int AS recent
    FROM requests
    WHERE created_at > now() - interval '60 seconds'
    GROUP BY 1
  `;

  const recentMap = Object.fromEntries(recentCounts.map((r) => [r.caller_id, Number(r.recent)]));
  const keyMap = Object.fromEntries(keys.map((k) => [k.caller_id, k]));

  return NextResponse.json({
    callers: callerStats.map((r) => ({
      caller_id: r.caller_id,
      requests: Number(r.requests),
      cost: Number(r.cost),
      tokens: Number(r.tokens),
      rate_limit_rpm: keyMap[r.caller_id]?.rate_limit_rpm ?? null,
      recent_rpm: recentMap[r.caller_id] ?? 0,
      allowed_tiers: keyMap[r.caller_id]?.allowed_tiers ?? [],
    })),
    keys: keys.map((k) => ({
      caller_id: k.caller_id,
      rate_limit_rpm: k.rate_limit_rpm,
      allowed_tiers: k.allowed_tiers,
      created_at: k.created_at,
    })),
  });
}
