import { createHash, randomBytes } from "crypto";
import type { Redis } from "ioredis";
import { getDb } from "./db.js";

export function generateApiKey(): { key: string; hash: string } {
  const raw = randomBytes(16).toString("hex");
  const key = `pg_live_${raw}`;
  return { key, hash: hashKey(key) };
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export type AuthStatus = 200 | 401 | 429;

export interface AuthResult {
  ok: boolean;
  status: AuthStatus;
  callerId?: string;
  allowedTiers?: string[];
}

// ponytail: fixed-window counter (not true token bucket); upgrade to sliding window if precision matters
export async function authenticate(
  rawKey: string,
  tier: string,
  redis: Redis
): Promise<AuthResult> {
  const hash = hashKey(rawKey);
  const apiKey = await getDb().apiKey.findUnique({ where: { key_hash: hash } });

  if (!apiKey || apiKey.revoked_at) {
    return { ok: false, status: 401 };
  }

  if (!apiKey.allowed_tiers.includes(tier)) {
    return { ok: false, status: 401 };
  }

  const windowKey = `ratelimit:${hash}:${Math.floor(Date.now() / 60000)}`;
  const count = await redis.incr(windowKey);
  if (count === 1) await redis.expire(windowKey, 60);

  if (count > apiKey.rate_limit_rpm) {
    return { ok: false, status: 429 };
  }

  return { ok: true, status: 200, callerId: apiKey.caller_id, allowedTiers: apiKey.allowed_tiers };
}
