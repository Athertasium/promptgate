import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json() as { enabled?: boolean; priority?: number; routing_strategy?: string };

  const data: Record<string, unknown> = { updated_at: new Date() };
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if (typeof body.priority === "number") data.priority = body.priority;
  if (body.routing_strategy) data.routing_strategy = body.routing_strategy;

  const entry = await getDb().modelTierEntry.update({
    where: { id },
    data,
  });

  return NextResponse.json(entry);
}
