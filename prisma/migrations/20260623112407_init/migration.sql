-- CreateTable
CREATE TABLE "requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tier" TEXT NOT NULL,
    "served_by_provider" TEXT,
    "served_by_model" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cost_usd" DECIMAL(10,6),
    "latency_ms" INTEGER,
    "cache_hit" BOOLEAN NOT NULL DEFAULT false,
    "failover_occurred" BOOLEAN NOT NULL DEFAULT false,
    "caller_id" TEXT,
    "tags" TEXT[],

    CONSTRAINT "requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "failover_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "from_provider" TEXT NOT NULL,
    "to_provider" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "added_latency_ms" INTEGER,

    CONSTRAINT "failover_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardrail_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "check_type" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" JSONB,

    CONSTRAINT "guardrail_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "semantic_cache_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "similarity_score" DOUBLE PRECISION NOT NULL,
    "would_have_hit" BOOLEAN NOT NULL,
    "matched_cache_key" TEXT,

    CONSTRAINT "semantic_cache_log_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "failover_events" ADD CONSTRAINT "failover_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardrail_events" ADD CONSTRAINT "guardrail_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semantic_cache_log" ADD CONSTRAINT "semantic_cache_log_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
