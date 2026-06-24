import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { generateApiKey } from "../auth.js";
import { getDb } from "../db.js";

const createKeySchema = z.object({
  caller_id: z.string().min(1),
  rate_limit_rpm: z.number().int().positive().default(60),
  allowed_tiers: z
    .array(z.enum(["fast", "balanced", "smart", "thinking"]))
    .default(["fast", "balanced", "smart", "thinking"]),
});

export async function keysRoute(app: FastifyInstance): Promise<void> {
  app.post("/v1/keys", async (request, reply) => {
    const parsed = createKeySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { caller_id, rate_limit_rpm, allowed_tiers } = parsed.data;
    const { key, hash } = generateApiKey();

    const record = await getDb().apiKey.create({
      data: { key_hash: hash, caller_id, rate_limit_rpm, allowed_tiers },
    });

    // Key shown once — hash stored, raw key is not persisted
    return reply.status(201).send({
      key,
      id: record.id,
      caller_id: record.caller_id,
      rate_limit_rpm: record.rate_limit_rpm,
      allowed_tiers: record.allowed_tiers,
      created_at: record.created_at,
    });
  });
}
