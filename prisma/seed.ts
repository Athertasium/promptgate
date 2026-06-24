import { MODEL_TIERS, TIER_ROUTING_STRATEGY } from "../shared/src/index";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");

const db = new PrismaClient({ adapter: new PrismaPg(url) });

async function seed() {
  const existing = await db.modelTierEntry.count();
  if (existing > 0) {
    console.log(`model_tier_entries already seeded (${existing} rows) — skipping`);
    return;
  }

  const rows = [];
  for (const [tier, entries] of Object.entries(MODEL_TIERS)) {
    const strategy = TIER_ROUTING_STRATEGY[tier as keyof typeof TIER_ROUTING_STRATEGY];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      rows.push({
        tier,
        provider: e.provider,
        model: e.model,
        priority: i,
        enabled: true,
        cost_per_1m_input: e.cost_per_1m_input,
        cost_per_1m_output: e.cost_per_1m_output,
        routing_strategy: strategy,
      });
    }
  }

  await db.modelTierEntry.createMany({ data: rows });
  console.log(`Seeded ${rows.length} model tier entries`);
}

seed().finally(() => db.$disconnect());
