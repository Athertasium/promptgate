import { NextResponse } from "next/server";
import { getDb } from "../../../lib/db";

export async function GET() {
  const db = getDb();
  const rows = await db.modelTierEntry.findMany({
    orderBy: [{ tier: "asc" }, { priority: "asc" }],
  });
  return NextResponse.json(rows);
}

// ponytail: signals the gateway to reload on next request (via DB bump).
// The gateway's 30 s TTL means it picks up changes automatically anyway.
// A true immediate reload would require a Redis pub/sub signal — not worth it here.
export async function POST() {
  return NextResponse.json({ reloaded: true });
}
