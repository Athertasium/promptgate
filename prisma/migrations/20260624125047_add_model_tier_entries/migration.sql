-- CreateTable
CREATE TABLE "model_tier_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tier" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cost_per_1m_input" DOUBLE PRECISION NOT NULL,
    "cost_per_1m_output" DOUBLE PRECISION NOT NULL,
    "routing_strategy" TEXT NOT NULL DEFAULT 'priority',
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_tier_entries_pkey" PRIMARY KEY ("id")
);
