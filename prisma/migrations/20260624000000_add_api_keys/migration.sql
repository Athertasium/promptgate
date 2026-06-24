-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key_hash" TEXT NOT NULL,
    "caller_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,
    "rate_limit_rpm" INTEGER NOT NULL DEFAULT 60,
    "allowed_tiers" TEXT[] NOT NULL DEFAULT ARRAY['fast', 'balanced', 'smart', 'thinking']::TEXT[],

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");
