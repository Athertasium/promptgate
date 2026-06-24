import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const ALLOWED_STRATEGIES = ["priority", "round_robin", "cost_aware"] as const;
  type RoutingStrategy = typeof ALLOWED_STRATEGIES[number];

  let body: { enabled?: boolean; priority?: number; routing_strategy?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    (body.enabled !== undefined && typeof body.enabled !== "boolean") ||
    (body.priority !== undefined && (typeof body.priority !== "number" || !Number.isInteger(body.priority) || body.priority < 0)) ||
    (body.routing_strategy !== undefined && !(ALLOWED_STRATEGIES as readonly string[]).includes(body.routing_strategy))
  ) {
    return NextResponse.json({ error: "Invalid fields" }, { status: 400 });
  }

  const data: Record<string, unknown> = { updated_at: new Date() };
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if (typeof body.priority === "number") data.priority = body.priority;
  if (body.routing_strategy) data.routing_strategy = body.routing_strategy as RoutingStrategy;

  const entry = await getDb().modelTierEntry.update({
    where: { id },
    data,
    select: {
      id: true,
      tier: true,
      provider: true,
      model: true,
      priority: true,
      enabled: true,
      cost_per_1m_input: true,
      cost_per_1m_output: true,
      routing_strategy: true,
    },
  });

  return NextResponse.json(entry);
}
