import { NextResponse } from "next/server";
import { getDb } from "../../../lib/db";

export async function GET() {
  const db = getDb();

  const [byTypeAction, recent] = await Promise.all([
    db.$queryRaw<{ check_type: string; action: string; count: number }[]>`
      SELECT check_type, action, COUNT(*)::int AS count
      FROM guardrail_events
      GROUP BY check_type, action
      ORDER BY count DESC
    `,
    db.guardrailEvent.findMany({
      orderBy: { created_at: "desc" },
      take: 30,
      select: {
        id: true,
        created_at: true,
        check_type: true,
        action: true,
        detail: true,
        request_id: true,
      },
    }),
  ]);

  return NextResponse.json({ byTypeAction, recent });
}
